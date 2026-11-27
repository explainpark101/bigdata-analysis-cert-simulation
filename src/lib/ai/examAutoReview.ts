import { loadAiSettings } from '@/lib/aiSettings';
import { runAuthorAgentTurn } from '@/lib/ai/authorAgent';
import type { AuthorDraft } from '@/lib/ai/authorChatStore';
import {
  finishAutoReviewChat,
  patchAutoReviewChat,
  startAutoReviewChat,
} from '@/lib/ai/autoReviewChatStore';
import {
  emptyModifyDraft,
  saveModifySession,
} from '@/lib/ai/modifyChatStore';
import {
  isAbortError,
  throwIfAborted,
  type ChatMessage,
} from '@/lib/ai/openaiCompatible';
import {
  cancelExamAutoReview,
  getExamAutoReviewJob,
  isExamAutoReviewRunning,
  patchExamAutoReviewJob,
  patchExamAutoReviewProblem,
  registerExamAutoReviewAbort,
  upsertExamAutoReviewJob,
  type ExamAutoReviewProblemState,
} from '@/lib/examAutoReviewQueue';
import { mountPathForAsset } from '@/lib/assetPaths';
import { buildStarterCode } from '@/lib/starterCode';
import {
  verifyBankProblemAnswer,
  type BankProblemVerifyResult,
} from '@/lib/verifyBankProblem';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
} from '@/types/project';

export type ExamAutoReviewDeps = {
  getProject: () => AuthoringProject;
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
  updateBankProblem: (id: string, patch: Partial<BankProblem>) => void;
};

function buildFixPrompt(
  problem: BankProblem,
  verify: BankProblemVerifyResult,
): string {
  const type2 = problem.taskType === 2 || problem.submitFormat === 'csv';
  const lines = [
    '자동 검수에서 이 문제의 정답 검증이 실패했습니다. 계획만 쓰지 말고 즉시 도구로 수정한 뒤 apply_changes(confirm=true)를 호출하세요.',
    '',
    `실패 사유: ${verify.reason}`,
    `실행 ok=${verify.ok} · match=${String(verify.match)}`,
  ];
  if (verify.stderr?.trim()) {
    lines.push('', '## stderr', '```', verify.stderr.slice(0, 4000), '```');
  }
  if (!type2) {
    lines.push(
      '',
      `## 입력된 단답 (기대)`,
      verify.expected.length
        ? verify.expected.map((e, i) => `${i + 1}. ${e}`).join('\n')
        : '(없음)',
      '',
      `## 실행 stdout 끝부분`,
      verify.got.length
        ? verify.got.slice(-Math.max(verify.expected.length, 5)).join('\n')
        : '(없음)',
    );
  } else {
    lines.push(
      '',
      '작업형 2유형: 답안 코드가 오류 없이 result.csv를 쓰도록 고치세요.',
      '채점(제출) CSV는 데이터 칼럼이 반드시 1개여야 합니다 (예측값 한 열, index/Unnamed 금지).',
    );
    if (verify.reason === 'type2_multi_column_csv') {
      lines.push(
        '실패 원인: result.csv 칼럼 수가 1개가 아닙니다. to_csv(..., index=False) / write.csv(..., row.names=FALSE)로 단일 예측 칼럼만 남기세요.',
      );
    }
    if (verify.reason === 'type2_index_column_csv') {
      lines.push(
        '실패 원인: result.csv에 index/Unnamed 칼럼이 있습니다. to_csv(..., index=False) / write.csv(..., row.names=FALSE)로 고치세요.',
      );
    }
    if (verify.reason === 'type2_missing_result_csv') {
      lines.push(
        '실패 원인: result.csv가 생성되지 않았습니다. 제출 파일명과 경로를 확인하세요.',
      );
    }
  }
  lines.push(
    '',
    '워크플로: list_project_csvs → (필요 시 MUTATE/SYNTHESIZE) → set_answer_code → run_answer_code → set_short_answers(1·3유형) → apply_changes(confirm=true).',
    'CSV와 정답이 어긋나면 CSV를 재생성·검증한 뒤 적용하세요. 수치 정답은 직접 지어내지 말고 실행 결과에서 설정하세요.',
  );
  return lines.join('\n');
}

function applyBankPatch(
  deps: ExamAutoReviewDeps,
  problemId: string,
  partial: Partial<BankProblem>,
): BankProblem {
  const project = deps.getProject();
  const current = project.bank.find((b) => b.id === problemId);
  if (!current) {
    throw new Error(`Problem not found: ${problemId}`);
  }
  const taskType = partial.taskType ?? current.taskType;
  const assetIds = partial.assetIds ?? current.assetIds;
  const paths = assetIds
    .map((id) => project.assets.find((a) => a.id === id))
    .filter((a): a is ProjectAsset => Boolean(a))
    .map((a) => mountPathForAsset(a));
  const next: BankProblem = {
    ...current,
    ...partial,
    id: problemId,
    number: current.number,
    taskType,
    assetIds,
    starterCode: buildStarterCode(taskType, paths),
  };
  deps.updateBankProblem(problemId, next);
  return next;
}

async function reviewOneProblem(
  deps: ExamAutoReviewDeps,
  examId: string,
  problemId: string,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  const fresh = deps.getProject().bank.find((b) => b.id === problemId);
  if (!fresh) {
    patchExamAutoReviewProblem(examId, problemId, {
      phase: 'failed',
      message: 'Problem missing from bank',
    });
    return;
  }

  const examTitle =
    getExamAutoReviewJob(examId)?.examTitle ??
    deps.getProject().exams.find((e) => e.id === examId)?.title ??
    examId;

  patchExamAutoReviewProblem(examId, problemId, {
    phase: 'verifying',
    message: '정답 검증 중…',
    title: fresh.title,
  });

  startAutoReviewChat({
    problemId,
    examId,
    examTitle,
    draft: emptyModifyDraft(fresh),
    messages: [
      {
        role: 'assistant',
        content: `일괄 자동 검수 · 정답 검증을 시작합니다. (${fresh.title})`,
      },
    ],
    liveStatus: '정답 검증 중…',
  });

  const project = deps.getProject();
  const verify = await verifyBankProblemAnswer(project, fresh);
  throwIfAborted(signal);

  if (!verify.needsAiReview) {
    const okMsg =
      verify.reason === 'type2_ok' ? '코드 실행 성공' : '정답 일치';
    finishAutoReviewChat(problemId, {
      messages: [
        {
          role: 'assistant',
          content: `정답 검증 통과 — ${okMsg}. AI 수정은 필요하지 않습니다.`,
        },
      ],
      liveStatus: okMsg,
    });
    patchExamAutoReviewProblem(examId, problemId, {
      phase: 'ok',
      message: okMsg,
    });
    return;
  }

  patchExamAutoReviewProblem(examId, problemId, {
    phase: 'ai_review',
    message:
      verify.reason === 'answer_mismatch'
        ? '단답 불일치 → AI 검수…'
        : verify.reason === 'runtime_error'
          ? '실행 오류 → AI 검수…'
          : 'AI 검수 중…',
  });

  const settings = await loadAiSettings();
  throwIfAborted(signal);

  const latest = deps.getProject().bank.find((b) => b.id === problemId) ?? fresh;
  const draft: AuthorDraft = emptyModifyDraft(latest);
  const peerReferenceIds = deps
    .getProject()
    .bank.filter((b) => b.id !== latest.id && b.taskType === latest.taskType)
    .slice(0, 12)
    .map((b) => b.id);

  const fixPrompt = buildFixPrompt(latest, verify);
  const seedMessages: ChatMessage[] = [
    {
      role: 'assistant',
      content: `정답 검증 실패 (${verify.reason}). AI 수정을 시작합니다.`,
    },
    { role: 'user', content: fixPrompt },
  ];
  patchAutoReviewChat(problemId, {
    draft,
    messages: seedMessages,
    liveStatus: 'AI 검수 요청 중…',
    error: '',
  });

  try {
    const result = await runAuthorAgentTurn({
      ctx: {
        settings,
        project: deps.getProject(),
        draft,
        referenceIds: peerReferenceIds,
        addProjectAssets: deps.addProjectAssets,
        mode: 'modify',
        targetProblem: latest,
      },
      history: [],
      userText: fixPrompt,
      onDraft: (nextDraft) => {
        patchAutoReviewChat(problemId, { draft: nextDraft });
      },
      onMessages: (messages) => {
        patchAutoReviewChat(problemId, { messages });
      },
      onSave: (partial) => applyBankPatch(deps, problemId, partial),
      onProgress: (ev) => {
        if (ev.kind === 'status') {
          patchExamAutoReviewProblem(examId, problemId, {
            phase: 'ai_review',
            message: ev.text,
          });
          patchAutoReviewChat(problemId, { liveStatus: ev.text });
        } else if (ev.kind === 'tool') {
          const text =
            ev.phase === 'start' ? `도구: ${ev.name}…` : `도구 완료: ${ev.name}`;
          patchExamAutoReviewProblem(examId, problemId, {
            phase: 'ai_review',
            message: text,
          });
          patchAutoReviewChat(problemId, { liveStatus: text });
        }
      },
      signal,
      requireSave: true,
    });

    throwIfAborted(signal);

    await saveModifySession({
      problemId,
      messages: result.messages,
      draft: result.draft,
      updatedAt: new Date().toISOString(),
    });

    if (!result.savedProblem) {
      finishAutoReviewChat(problemId, {
        messages: result.messages,
        draft: result.draft,
        liveStatus: '',
        error: 'AI가 변경을 적용하지 못했습니다',
      });
      patchExamAutoReviewProblem(examId, problemId, {
        phase: 'failed',
        message: 'AI가 변경을 적용하지 못했습니다',
      });
      return;
    }

    // Re-verify after AI apply.
    const after = deps.getProject().bank.find((b) => b.id === problemId);
    if (!after) {
      finishAutoReviewChat(problemId, {
        messages: result.messages,
        draft: result.draft,
        liveStatus: '반영됨',
      });
      patchExamAutoReviewProblem(examId, problemId, {
        phase: 'fixed',
        message: '반영됨 (재검증 생략: 문제 없음)',
      });
      return;
    }
    patchAutoReviewChat(problemId, { liveStatus: '수정 후 재검증 중…' });
    const recheck = await verifyBankProblemAnswer(deps.getProject(), after);
    throwIfAborted(signal);

    if (!recheck.needsAiReview) {
      finishAutoReviewChat(problemId, {
        messages: result.messages,
        draft: result.draft,
        liveStatus: 'AI 수정 후 검증 통과',
      });
      patchExamAutoReviewProblem(examId, problemId, {
        phase: 'fixed',
        message: 'AI 수정 후 검증 통과',
      });
    } else {
      finishAutoReviewChat(problemId, {
        messages: result.messages,
        draft: result.draft,
        liveStatus: `반영됨 · 재검증 미통과 (${recheck.reason})`,
      });
      patchExamAutoReviewProblem(examId, problemId, {
        phase: 'fixed',
        message: `반영됨 · 재검증 미통과 (${recheck.reason})`,
      });
    }
  } catch (err) {
    if (isAbortError(err)) {
      finishAutoReviewChat(problemId, {
        liveStatus: '',
        error: '취소됨',
      });
      patchExamAutoReviewProblem(examId, problemId, {
        phase: 'cancelled',
        message: '취소됨',
      });
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    finishAutoReviewChat(problemId, {
      liveStatus: '',
      error: msg,
    });
    patchExamAutoReviewProblem(examId, problemId, {
      phase: 'failed',
      message: msg,
    });
  }
}

/**
 * Start auto-review for one exam paper. All problems run concurrently.
 * Safe to call for multiple papers; navigating away does not cancel.
 */
export function startExamAutoReview(
  examId: string,
  deps: ExamAutoReviewDeps,
): { started: boolean; reason?: string } {
  if (isExamAutoReviewRunning(examId)) {
    return { started: false, reason: 'already_running' };
  }

  const project = deps.getProject();
  const exam = project.exams.find((e) => e.id === examId);
  if (!exam) {
    return { started: false, reason: 'exam_not_found' };
  }
  if (!exam.problemIds.length) {
    return { started: false, reason: 'empty_exam' };
  }

  const bankMap = new Map(project.bank.map((b) => [b.id, b]));
  const problems: ExamAutoReviewProblemState[] = exam.problemIds.map((id) => {
    const p = bankMap.get(id);
    return {
      problemId: id,
      title: p?.title ?? id,
      taskType: p?.taskType ?? 0,
      phase: 'queued',
      updatedAt: Date.now(),
    };
  });

  const ctrl = new AbortController();
  registerExamAutoReviewAbort(examId, ctrl);

  const now = Date.now();
  upsertExamAutoReviewJob({
    examId,
    examTitle: exam.title,
    phase: 'running',
    problems,
    startedAt: now,
    updatedAt: now,
  });

  void (async () => {
    try {
      await Promise.all(
        exam.problemIds.map((problemId) =>
          reviewOneProblem(deps, examId, problemId, ctrl.signal).catch(
            (err) => {
              if (isAbortError(err)) return;
              patchExamAutoReviewProblem(examId, problemId, {
                phase: 'failed',
                message: err instanceof Error ? err.message : String(err),
              });
            },
          ),
        ),
      );

      if (ctrl.signal.aborted) {
        patchExamAutoReviewJob(examId, {
          phase: 'cancelled',
          message: 'Cancelled',
        });
        return;
      }

      const job = patchExamAutoReviewJob(examId, { phase: 'done' });
      if (job) {
        const failed = job.problems.filter((p) => p.phase === 'failed').length;
        const fixed = job.problems.filter((p) => p.phase === 'fixed').length;
        const ok = job.problems.filter((p) => p.phase === 'ok').length;
        patchExamAutoReviewJob(examId, {
          phase: 'done',
          message: `완료 · 통과 ${ok} · 수정 ${fixed} · 실패 ${failed}`,
        });
      }
    } catch (err) {
      if (isAbortError(err)) {
        patchExamAutoReviewJob(examId, {
          phase: 'cancelled',
          message: 'Cancelled',
        });
        return;
      }
      patchExamAutoReviewJob(examId, {
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return { started: true };
}

export { cancelExamAutoReview };

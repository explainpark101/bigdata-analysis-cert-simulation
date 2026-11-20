import type {
  CodeByLanguage,
  ExamLanguage,
  QuizKind,
  SubmitFormat,
} from '@/types/exam';

/** CSV (or other) file stored once in the authoring project library. */
export interface ProjectAsset {
  id: string;
  /**
   * Library tree path (may be nested, e.g. data/type1/median.csv).
   * Runtime / code load path is always flat: data/<filename> or images/<filename>.
   */
  path: string;
  name: string;
  encoding: 'utf-8' | 'base64';
  content: string;
  mimeType?: string;
}

/** 작업형 유형 (빅데이터분석기사 실기 1·2·3) */
export type TaskType = 1 | 2 | 3;

/**
 * Problem-bank item. Does not embed file bytes — selects from project.assets.
 */
export interface BankProblem {
  id: string;
  number: string;
  /**
   * Authoring-only label (bank list). Exam UI always shows
   * `제N유형 M번` instead of this title.
   */
  title: string;
  /**
   * Optional note: when/how this problem was authored or adapted.
   * Shown under the exam title only if showNoteOnExam is true.
   */
  note?: string;
  /** Whether to show `note` on the exam paper */
  showNoteOnExam?: boolean;
  /** 작업형 1 / 2 / 3 */
  taskType: TaskType;
  kind: QuizKind;
  markdown: string;
  language: ExamLanguage;
  /** Skeleton shown to examinees — must not contain the full solution */
  starterCode: CodeByLanguage;
  /** Author reference solution (code) */
  answerCode?: CodeByLanguage;
  /** Author short-answer key (유형 1·3 단답, single) */
  shortAnswer?: string;
  /** Multiple short-answer keys when one bank item holds several 소문항 */
  shortAnswers?: string[];
  /**
   * 작업형 2 채점용 코드: 기준 모델·학습 방법·평가지표로 result.csv 평가.
   */
  gradingCode?: CodeByLanguage;
  /** Selected project asset ids for this problem */
  assetIds: string[];
  /** If set, this bank item was generated as a variant of another problem */
  sourceProblemId?: string;
  /**
   * Type-2 variant: Python code that generates dataset CSVs under out/
   * (rules-based synthesis; not LLM-invented rows).
   */
  datasetCode?: string;
  submitFormat?: SubmitFormat;
  submitFile?: string;
  testCases?: Array<{
    id: string;
    name: string;
    expectIncludes?: string[];
  }>;
}

/** Draft exam paper assembled from the bank (ids only until export). */
export interface ExamBlueprint {
  id: string;
  title: string;
  description?: string;
  /** Exam duration in minutes. Default 180 (3h). `null` = no limit. */
  timeLimitMinutes: number | null;
  /** Max code run time per execution (seconds). Default 60. */
  maxRunSeconds: number;
  /** Ordered bank problem ids included in the exam */
  problemIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Authoring project = CSV library + problem bank + multiple exam papers.
 * Separate from take-home ExamSet (exam.json / *.exam.zip).
 */
export interface AuthoringProject {
  schemaVersion: 1;
  kind: 'project';
  id: string;
  title: string;
  description?: string;
  assets: ProjectAsset[];
  bank: BankProblem[];
  /** Saved exam papers (조립된 시험지) */
  exams: ExamBlueprint[];
  /** Currently selected exam paper id for editing / export */
  activeExamId: string;
  createdAt?: string;
  updatedAt?: string;
}

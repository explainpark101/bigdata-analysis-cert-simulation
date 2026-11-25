/**
 * Package pins aligned with C:\\projects\\bigdata-knight\\config\\requirements.txt
 * when the same (or near) versions are available in Pyodide / webR.
 * Browser WASM cannot load selenium / browser drivers; those are listed as unavailable.
 */
export const BIGDATA_KNIGHT_PYTHON_PINS: Record<string, string> = {
  numpy: '1.26.4',
  pandas: '2.2.2',
  'scikit-learn': '1.5.2',
  scipy: '1.14.1',
  matplotlib: '3.9.2',
  seaborn: '0.13.2',
  statsmodels: '0.14.1',
  xgboost: '2.1.2',
  lightgbm: '4.5.0',
  joblib: '1.4.2',
  pillow: '11.0.0',
  tabulate: '0.9.0',
  pingouin: '0.5.5',
  xarray: '2024.10.0',
};

/** Packages we attempt to load via Pyodide (name as Pyodide/micropip expects). */
export const PYODIDE_LOAD_PACKAGES = [
  'numpy',
  'pandas',
  'scipy',
  'scikit-learn',
  'matplotlib',
  'seaborn',
  'statsmodels',
  'xgboost',
  'lightgbm',
  'joblib',
  'pillow',
  'micropip',
] as const;

/**
 * Packages authors may assume in R (webR installs on `library()`).
 * tidyverse meta-package or its core members + broom + lubridate.
 */
export const WEBR_SUGGESTED_PACKAGES = [
  'tidyverse',
  'dplyr',
  'tidyr',
  'readr',
  'ggplot2',
  'stringr',
  'purrr',
  'tibble',
  'forcats',
  'broom',
  'lubridate',
  'caret',
  'randomForest',
  'data.table',
] as const;

export const UNAVAILABLE_IN_BROWSER = [
  'selenium',
  'trio',
  'trio-websocket',
  'websocket-client',
] as const;

export const DEFAULT_PYTHON_STARTER = `# · 코드 실행 시 제공 패키지 리스트 확인 가능
import importlib.metadata as metadata
import pandas

pandas.set_option("display.max_rows", None)
packages = sorted(
    [(d.metadata["Name"].lower(), d.version) for d in metadata.distributions()],
    key=lambda x: x[0],
)
OutputDataSet = pandas.DataFrame(packages, columns=["package", "version"])
print(OutputDataSet)
# 파이썬 제공 패키지 수 (bigdata-knight 정렬 핀 기준 로드 시도)
# Warning 메세지로 인한 실행 실패 안내는 실행 및 결과에 영향없음.
`;

export const DEFAULT_R_STARTER = `# · R 패키지 목록 확인
pkgs <- installed.packages()[, c("Package", "Version")]
print(as.data.frame(pkgs, stringsAsFactors = FALSE))
`;

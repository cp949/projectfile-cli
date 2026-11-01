import type { ProjectFileFailure } from "@cp949/projectfile";

/** 실행 중 실패. 종료 코드 1. */
export class CliError extends Error {}

/** 명령줄 사용법 오류. 종료 코드 2. */
export class UsageError extends Error {}

/** 라이브러리 실패를 `reason key="value" ...` 한 줄로 만든다. */
export function formatFailure(failure: ProjectFileFailure): string {
  const extra = Object.entries(failure)
    .filter(([key]) => key !== "reason")
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return [failure.reason, ...extra].join(" ");
}

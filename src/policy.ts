// CLI가 라이브러리에 넘기는 rules와 limits. 인코딩과 디코딩이 같은 값을 써야 한다.
// - 내용과 사용처를 모르므로 라이브러리가 허용하는 상한을 쓴다.
// - maxFiles + maxFolders는 65,533 이하여야 해서 둘로 나눈다. 디코딩은 열기 전에 개수를 모르므로 고정값이다.
import {
  MAX_PATH_LENGTH_CEILING,
  MAX_UNCOMPRESSED_BYTES_CEILING,
  type ProjectFileLimits,
  type ProjectFileRules,
} from "@cp949/projectfile";

export const RULES: ProjectFileRules = {
  maxPathLength: MAX_PATH_LENGTH_CEILING,
  isCode: () => false,
};

export const LIMITS: ProjectFileLimits = {
  maxFiles: 32767,
  maxFolders: 32766,
  maxAssetBytes: MAX_UNCOMPRESSED_BYTES_CEILING,
  maxAssetsTotalBytes: MAX_UNCOMPRESSED_BYTES_CEILING,
  maxCodeBytes: MAX_UNCOMPRESSED_BYTES_CEILING,
  maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES_CEILING,
};

// 라이브러리의 kind 규칙과 같다(`@cp949/projectfile` README의 "kind").
// 라이브러리는 어기면 던지므로, 사용법 오류로 알리려고 먼저 검사한다.
export const KIND_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

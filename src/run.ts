// 명령줄 진입점의 본체. 입출력을 주입받아 시험에서 그대로 부른다.
import { openAsBlob } from "node:fs";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  decodeProjectFile,
  encodeProjectFile,
  readProjectFileHeader,
  type ScrambleScope,
} from "@cp949/projectfile";
import { collect } from "./collect.ts";
import { CliError, formatFailure, UsageError } from "./errors.ts";
import { extract } from "./extract.ts";
import { errorCode, writeBlobExclusive } from "./fs-util.ts";
import { KIND_PATTERN, LIMITS, RULES } from "./policy.ts";

export interface Io {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const USAGE = `사용법:
  projectfile encode --kind <kind> [-v1|-v2] -o <출력 파일> <경로...>
  projectfile decode -o <출력 폴더> <파일>

encode
  경로마다 마지막 이름으로 들어간다. 파일은 파일 이름, 폴더는 폴더 이름부터다.
  "."은 현재 폴더의 내용을 최상위에 넣는다.
  모든 파일은 asset(원본 바이트)으로 담는다. 기본 scramble 키를 쓴다.
  --kind <kind>       필수. 정규식 ^[a-z0-9][a-z0-9._-]{0,63}$
  -v1                 포맷 버전 1(기본값). 메타데이터만 섞는다. 파일 본문은 평문으로 남는다.
  -v2                 포맷 버전 2. ZIP 전체를 섞는다. 소스 코드를 담으면 이쪽을 쓴다.
  -o <출력 파일>      필수. 이미 있으면 실패한다.

decode
  kind는 파일 헤더에서 읽는다. 이미 있는 파일은 덮어쓰지 않는다.
  -o <출력 폴더>      필수. 없으면 만든다.

종료 코드: 0 성공, 1 실패, 2 사용법 오류
`;

export async function run(argv: readonly string[], io: Io): Promise<number> {
  try {
    const [command, ...rest] = argv;
    switch (command) {
      case "encode":
        return await encode(rest, io);
      case "decode":
        return await decode(rest, io);
      case "-h":
      case "--help":
        io.stdout(USAGE);
        return 0;
      default:
        throw new UsageError(
          command === undefined ? "명령이 없다" : `모르는 명령이다: ${command}`,
        );
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`오류: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    io.stderr(
      `오류: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

async function encode(args: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, {
    kind: { type: "string" },
    "format-version": { type: "string", short: "v" },
    output: { type: "string", short: "o" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help === true) {
    io.stdout(USAGE);
    return 0;
  }
  const kind = values.kind;
  if (typeof kind !== "string") throw new UsageError("--kind가 없다");
  if (!KIND_PATTERN.test(kind))
    throw new UsageError(`kind가 규칙을 어겼다: ${kind}`);
  const scrambleScope = toScope(values["format-version"]);
  const output = values.output;
  if (typeof output !== "string") throw new UsageError("-o가 없다");
  if (positionals.length === 0) throw new UsageError("담을 경로가 없다");

  const outPath = resolve(io.cwd, output);
  if (await pathExists(outPath))
    throw new CliError(`출력 파일이 이미 있다: ${output}`);

  const { entries, folders } = await collect(positionals, io.cwd);
  const result = await encodeProjectFile({
    kind,
    entries,
    folders,
    rules: RULES,
    limits: LIMITS,
    scrambleScope,
  });
  if (!result.ok) throw new CliError(formatFailure(result.failure));

  try {
    await writeBlobExclusive(outPath, result.value);
  } catch (error) {
    if (errorCode(error) === "EEXIST")
      throw new CliError(`출력 파일이 이미 있다: ${output}`);
    throw error;
  }
  const version = scrambleScope === "all" ? 2 : 1;
  io.stdout(
    `${output}: 파일 ${entries.length}개, 폴더 ${folders.length}개, ${result.value.size}바이트, 포맷 버전 ${version}\n`,
  );
  return 0;
}

async function decode(args: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, {
    output: { type: "string", short: "o" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help === true) {
    io.stdout(USAGE);
    return 0;
  }
  const output = values.output;
  if (typeof output !== "string") throw new UsageError("-o가 없다");
  const [input, ...extra] = positionals;
  if (input === undefined) throw new UsageError("입력 파일이 없다");
  if (extra.length > 0) throw new UsageError("입력 파일은 하나다");

  let blob: Blob;
  try {
    blob = await openAsBlob(resolve(io.cwd, input));
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      throw new CliError(`입력 파일이 없다: ${input}`);
    throw error;
  }
  // kind를 모르므로 헤더에서 읽어 그대로 기대값으로 쓴다.
  const head = await readProjectFileHeader(blob);
  if (!head.ok) throw new CliError(formatFailure(head.failure));
  const result = await decodeProjectFile(blob, {
    kind: head.value.kind,
    rules: RULES,
    limits: LIMITS,
  });
  if (!result.ok) throw new CliError(formatFailure(result.failure));

  await extract(result.value, resolve(io.cwd, output));
  io.stdout(
    `${output}: 파일 ${result.value.entries.length}개, 폴더 ${result.value.folders.length}개, kind ${head.value.kind}, 포맷 버전 ${head.value.version}\n`,
  );
  return 0;
}

// parseArgs의 오류(모르는 옵션, 값 없는 옵션)를 사용법 오류로 바꾼다.
function parse<
  T extends NonNullable<Parameters<typeof parseArgs>[0]>["options"],
>(args: readonly string[], options: T) {
  try {
    return parseArgs({
      args: [...args],
      options,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function toScope(value: string | boolean | undefined): ScrambleScope {
  if (value === undefined || value === "1") return "metadata";
  if (value === "2") return "all";
  throw new UsageError(`포맷 버전은 1이나 2다: ${String(value)}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

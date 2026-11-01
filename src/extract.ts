// 디코딩 결과를 출력 폴더에 쓴다.
// - 이미 있는 파일은 덮어쓰지 않는다. 쓰기 전에 모든 대상을 검사해 하나라도 있으면 아무것도 쓰지 않는다.
// - text 항목은 UTF-8 바이트로, asset 항목은 원본 바이트로 쓴다.
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { DecodedProject } from "@cp949/projectfile";
import { CliError } from "./errors.ts";
import { errorCode, writeBlobExclusive } from "./fs-util.ts";

export async function extract(
  project: DecodedProject,
  outDir: string,
): Promise<void> {
  const files = project.entries.map((entry) => ({
    entry,
    abs: inside(outDir, entry.path),
  }));
  const folders = project.folders.map((folder) => ({
    folder,
    abs: inside(outDir, folder),
  }));

  for (const { entry, abs } of files) {
    if (await exists(abs))
      throw new CliError(`이미 있는 파일이다: ${entry.path}`);
  }
  for (const { folder, abs } of folders) {
    const stat = await lstatOrUndefined(abs);
    if (stat !== undefined && !stat.isDirectory()) {
      throw new CliError(`폴더 자리에 다른 것이 있다: ${folder}`);
    }
  }

  await mkdir(outDir, { recursive: true });
  for (const { abs } of folders) await mkdir(abs, { recursive: true });
  for (const { entry, abs } of files) {
    await mkdir(dirname(abs), { recursive: true });
    if (entry.type === "text") {
      await writeFile(abs, entry.data, { encoding: "utf8", flag: "wx" });
    } else {
      await writeBlobExclusive(abs, entry.data);
    }
  }
}

// 항목 경로를 출력 폴더 안의 절대 경로로 바꾼다.
// - 라이브러리가 `..`, `\`, 앞 `/`를 막지만, Windows의 드라이브 문자(`C:`) 같은 플랫폼 차이를 대비해 한 번 더 막는다.
function inside(outDir: string, path: string): string {
  const abs = resolve(outDir, ...path.split("/"));
  if (!abs.startsWith(outDir + sep)) {
    throw new CliError(`출력 폴더 밖을 가리키는 경로다: ${path}`);
  }
  return abs;
}

async function exists(abs: string): Promise<boolean> {
  return (await lstatOrUndefined(abs)) !== undefined;
}

async function lstatOrUndefined(abs: string) {
  try {
    return await lstat(abs);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

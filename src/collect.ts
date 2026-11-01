// 명령줄 경로 인자를 인코딩 항목과 폴더 목록으로 바꾼다.
// - 인자마다 마지막 이름으로 들어간다. 파일은 파일 이름, 폴더는 폴더 이름부터다.
// - "."(정규화해서 현재 폴더)만 그 폴더의 내용을 최상위에 넣는다.
// - 내용을 보지 않는다. 모든 파일은 asset(원본 바이트)이다.
import { openAsBlob } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, join, normalize, resolve } from "node:path";
import type { ProjectEntry } from "@cp949/projectfile";
import { CliError } from "./errors.ts";
import { errorCode } from "./fs-util.ts";

export interface Collected {
  entries: ProjectEntry[];
  folders: string[];
}

export async function collect(
  args: readonly string[],
  cwd: string,
): Promise<Collected> {
  const collected: Collected = { entries: [], folders: [] };
  // 최상위 이름 → 그 이름을 낸 인자. 서로 다른 인자의 같은 이름은 내용이 합쳐지므로 막는다.
  const owners = new Map<string, string>();
  const claim = (name: string, arg: string) => {
    const owner = owners.get(name);
    if (owner !== undefined) {
      throw new CliError(`최상위 이름이 겹친다: ${name} (${owner}, ${arg})`);
    }
    owners.set(name, arg);
  };

  for (const arg of args) {
    const abs = resolve(cwd, arg);
    const stat = await lstatOrFail(abs, arg);
    if (isCurrentDir(arg)) {
      if (!stat.isDirectory()) throw new CliError(`폴더가 아니다: ${arg}`);
      for (const name of await sortedNames(abs)) {
        claim(name, arg);
        await add(collected, join(abs, name), name);
      }
      continue;
    }
    const name = basename(abs);
    if (name === "") throw new CliError(`최상위 이름을 정할 수 없다: ${arg}`);
    claim(name, arg);
    await add(collected, abs, name);
  }
  return collected;
}

// "."와 "./", "a/.."처럼 정규화해서 현재 폴더인 인자.
function isCurrentDir(arg: string): boolean {
  const n = normalize(arg).replace(/[\\/]+$/, "");
  return n === "." || n === "";
}

async function add(
  collected: Collected,
  abs: string,
  path: string,
): Promise<void> {
  const stat = await lstatOrFail(abs, path);
  if (stat.isSymbolicLink()) {
    throw new CliError(`심볼릭 링크는 담지 않는다: ${path}`);
  }
  if (stat.isDirectory()) {
    collected.folders.push(path);
    for (const name of await sortedNames(abs)) {
      await add(collected, join(abs, name), `${path}/${name}`);
    }
    return;
  }
  if (!stat.isFile()) {
    throw new CliError(`일반 파일이나 폴더가 아니다: ${path}`);
  }
  // openAsBlob은 내용을 메모리에 올리지 않는다. 라이브러리가 필요할 때 읽는다.
  collected.entries.push({ path, type: "asset", data: await openAsBlob(abs) });
}

// 같은 폴더는 항상 같은 순서로 담도록 이름을 코드 유닛 순으로 정렬한다.
async function sortedNames(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

async function lstatOrFail(abs: string, label: string) {
  try {
    return await lstat(abs);
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      throw new CliError(`경로가 없다: ${label}`);
    throw error;
  }
}

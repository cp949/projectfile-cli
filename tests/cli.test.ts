import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeProjectFile, readProjectFileHeader } from "@cp949/projectfile";
import { run } from "../src/run.ts";
import { LIMITS, RULES } from "../src/policy.ts";

let root: string;
let out: string[];
let err: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "projectfile-cli-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// cwd를 바꿔 CLI를 실행하고 종료 코드를 돌려준다.
function cli(cwd: string, ...argv: string[]): Promise<number> {
  return run(argv, {
    cwd,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
}

// 폴더 안의 모든 경로를 "/"로 이어 정렬해 돌려준다. 폴더는 끝에 "/"를 붙인다.
async function tree(dir: string): Promise<string[]> {
  const items = await readdir(dir, { recursive: true, withFileTypes: true });
  return items
    .map((d) => {
      const rel = join(d.parentPath, d.name).slice(dir.length + 1);
      return rel.split("\\").join("/") + (d.isDirectory() ? "/" : "");
    })
    .sort();
}

// root/src 아래에 aaa/test.txt, aaa/sub/b.bin, aaa/empty/를 만든다.
async function makeSample(): Promise<string> {
  const src = join(root, "src");
  await mkdir(join(src, "aaa", "sub"), { recursive: true });
  await mkdir(join(src, "aaa", "empty"));
  await writeFile(join(src, "aaa", "test.txt"), "hello");
  await writeFile(
    join(src, "aaa", "sub", "b.bin"),
    new Uint8Array([0xff, 0xfe, 0x00, 0x80]),
  );
  return src;
}

describe("encode 경로 규칙", () => {
  it("폴더 인자는 폴더 이름부터 들어간다", async () => {
    const src = await makeSample();
    expect(
      await cli(src, "encode", "--kind", "t.a", "-o", "../p.bin", "aaa/"),
    ).toBe(0);
    expect(await cli(root, "decode", "-o", "out", "p.bin")).toBe(0);
    expect(await tree(join(root, "out"))).toEqual([
      "aaa/",
      "aaa/empty/",
      "aaa/sub/",
      "aaa/sub/b.bin",
      "aaa/test.txt",
    ]);
  });

  it("점(.)은 현재 폴더의 내용을 넣는다", async () => {
    const src = await makeSample();
    const aaa = join(src, "aaa");
    expect(
      await cli(aaa, "encode", "--kind", "t.a", "-o", "../../p.bin", "."),
    ).toBe(0);
    expect(await cli(root, "decode", "-o", "out", "p.bin")).toBe(0);
    expect(await tree(join(root, "out"))).toEqual([
      "empty/",
      "sub/",
      "sub/b.bin",
      "test.txt",
    ]);
  });

  it("파일 인자는 파일 이름만 들어간다", async () => {
    const src = await makeSample();
    expect(
      await cli(
        src,
        "encode",
        "--kind",
        "t.a",
        "-o",
        "../p.bin",
        "aaa/test.txt",
        "aaa/sub",
      ),
    ).toBe(0);
    expect(await cli(root, "decode", "-o", "out", "p.bin")).toBe(0);
    expect(await tree(join(root, "out"))).toEqual([
      "sub/",
      "sub/b.bin",
      "test.txt",
    ]);
  });

  it("최상위 이름이 겹치면 실패하고 출력 파일을 만들지 않는다", async () => {
    const src = await makeSample();
    await mkdir(join(src, "bbb"));
    await writeFile(join(src, "bbb", "test.txt"), "x");
    const code = await cli(
      src,
      "encode",
      "--kind",
      "t.a",
      "-o",
      "p.bin",
      "aaa/test.txt",
      "bbb/test.txt",
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain("test.txt");
    await expect(readFile(join(src, "p.bin"))).rejects.toThrow();
  });

  it("심볼릭 링크는 실패한다", async () => {
    const src = await makeSample();
    await symlink(join(src, "aaa", "test.txt"), join(src, "aaa", "link.txt"));
    expect(
      await cli(src, "encode", "--kind", "t.a", "-o", "p.bin", "aaa"),
    ).toBe(1);
    expect(err.join("")).toContain("link.txt");
    await expect(readFile(join(src, "p.bin"))).rejects.toThrow();
  });

  it("없는 경로는 실패한다", async () => {
    expect(
      await cli(root, "encode", "--kind", "t.a", "-o", "p.bin", "none"),
    ).toBe(1);
    expect(err.join("")).toContain("none");
  });
});

describe("encode 출력", () => {
  it("바이트가 그대로 왕복한다", async () => {
    const src = await makeSample();
    expect(
      await cli(src, "encode", "--kind", "t.a", "-o", "../p.bin", "aaa"),
    ).toBe(0);
    expect(await cli(root, "decode", "-o", "out", "p.bin")).toBe(0);
    expect(
      new Uint8Array(await readFile(join(root, "out", "aaa", "sub", "b.bin"))),
    ).toEqual(new Uint8Array([0xff, 0xfe, 0x00, 0x80]));
    expect(await readFile(join(root, "out", "aaa", "test.txt"), "utf8")).toBe(
      "hello",
    );
  });

  it("포맷 버전 기본값은 1이고 -v2는 2다", async () => {
    const src = await makeSample();
    expect(
      await cli(src, "encode", "--kind", "t.a", "-o", "p1.bin", "aaa"),
    ).toBe(0);
    expect(
      await cli(src, "encode", "--kind", "t.a", "-v2", "-o", "p2.bin", "aaa"),
    ).toBe(0);
    expect(
      await cli(src, "encode", "--kind", "t.a", "-v1", "-o", "p3.bin", "aaa"),
    ).toBe(0);
    const version = async (name: string) => {
      const head = await readProjectFileHeader(
        await openAsBlob(join(src, name)),
      );
      if (!head.ok) throw new Error(head.failure.reason);
      return head.value;
    };
    expect(await version("p1.bin")).toMatchObject({ version: 1, kind: "t.a" });
    expect(await version("p2.bin")).toMatchObject({ version: 2 });
    expect(await version("p3.bin")).toMatchObject({ version: 1 });
  });

  it("출력 파일이 이미 있으면 덮어쓰지 않는다", async () => {
    const src = await makeSample();
    await writeFile(join(src, "p.bin"), "keep");
    expect(
      await cli(src, "encode", "--kind", "t.a", "-o", "p.bin", "aaa"),
    ).toBe(1);
    expect(await readFile(join(src, "p.bin"), "utf8")).toBe("keep");
  });

  it("라이브러리가 거부한 이름은 이유와 경로를 출력한다", async () => {
    const src = join(root, "src");
    await mkdir(src);
    await writeFile(join(src, " lead.txt"), "x");
    expect(
      await cli(src, "encode", "--kind", "t.a", "-o", "p.bin", " lead.txt"),
    ).toBe(1);
    expect(err.join("")).toContain("invalid-name");
    await expect(readFile(join(src, "p.bin"))).rejects.toThrow();
  });
});

describe("decode", () => {
  it("다른 앱이 만든 text 항목을 UTF-8로 쓴다", async () => {
    const encoded = await encodeProjectFile({
      kind: "acme.blocks",
      entries: [{ path: "d/한글.json", type: "text", data: '{"a":"가"}' }],
      rules: RULES,
      limits: LIMITS,
    });
    if (!encoded.ok) throw new Error(encoded.failure.reason);
    await writeFile(
      join(root, "p.bin"),
      new Uint8Array(await encoded.value.arrayBuffer()),
    );
    expect(await cli(root, "decode", "-o", "out", "p.bin")).toBe(0);
    expect(await readFile(join(root, "out", "d", "한글.json"), "utf8")).toBe(
      '{"a":"가"}',
    );
  });

  it("대상 파일이 이미 있으면 아무것도 쓰지 않고 실패한다", async () => {
    const src = await makeSample();
    expect(
      await cli(src, "encode", "--kind", "t.a", "-o", "../p.bin", "aaa"),
    ).toBe(0);
    await mkdir(join(root, "out", "aaa"), { recursive: true });
    await writeFile(join(root, "out", "aaa", "test.txt"), "keep");
    expect(await cli(root, "decode", "-o", "out", "p.bin")).toBe(1);
    expect(err.join("")).toContain("test.txt");
    expect(await readFile(join(root, "out", "aaa", "test.txt"), "utf8")).toBe(
      "keep",
    );
    expect(await tree(join(root, "out"))).toEqual(["aaa/", "aaa/test.txt"]);
  });

  it("프로젝트 파일이 아니면 이유를 출력하고 실패한다", async () => {
    await writeFile(join(root, "p.bin"), "not a project file");
    expect(await cli(root, "decode", "-o", "out", "p.bin")).toBe(1);
    expect(err.join("")).toContain("bad-magic");
  });
});

describe("사용법 오류", () => {
  it("encode에 --kind가 없으면 종료 코드 2다", async () => {
    expect(await cli(root, "encode", "-o", "p.bin", ".")).toBe(2);
  });

  it("포맷 버전이 1이나 2가 아니면 종료 코드 2다", async () => {
    expect(
      await cli(root, "encode", "--kind", "t.a", "-v3", "-o", "p.bin", "."),
    ).toBe(2);
  });

  it("kind가 규칙을 어기면 종료 코드 2다", async () => {
    expect(
      await cli(root, "encode", "--kind", "Bad Kind", "-o", "p.bin", "."),
    ).toBe(2);
  });

  it("decode에 -o가 없으면 종료 코드 2다", async () => {
    expect(await cli(root, "decode", "p.bin")).toBe(2);
  });

  it("모르는 명령은 종료 코드 2다", async () => {
    expect(await cli(root, "list")).toBe(2);
  });

  it("--help는 사용법을 출력하고 종료 코드 0이다", async () => {
    expect(await cli(root, "--help")).toBe(0);
    expect(out.join("")).toContain("projectfile encode");
  });
});

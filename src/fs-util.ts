import { open, rm } from "node:fs/promises";

/**
 * Blob을 새 파일에 조각으로 쓴다. 파일이 이미 있으면 EEXIST로 실패한다.
 * - 쓰다가 실패하면 만든 파일을 지운다.
 */
export async function writeBlobExclusive(
  path: string,
  blob: Blob,
): Promise<void> {
  const handle = await open(path, "wx");
  try {
    for await (const chunk of blob.stream()) {
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close();
    await rm(path, { force: true });
    throw error;
  }
  await handle.close();
}

/** Node 파일 시스템 오류의 code. 없으면 undefined. */
export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

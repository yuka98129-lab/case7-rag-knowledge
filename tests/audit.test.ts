import { describe, expect, it } from "vitest";
import { AuditError, departmentsOf, writeQueryLog } from "../src/lib/audit";

// supabase-js の代わりになる、偽のクライアント
function fakeInsertClient(result: { error: { message: string } | null }) {
  const calls: { table: string; row: unknown }[] = [];
  const client = {
    from: (table: string) => ({
      insert: async (row: unknown) => {
        calls.push({ table, row });
        return result;
      },
    }),
  };
  return { client: client as any, calls };
}

function fakeSelectClient(rows: { department: string }[] | null, error: { message: string } | null = null) {
  const seen: { table: string; col?: string; val?: string } = { table: "" };
  const client = {
    from: (table: string) => {
      seen.table = table;
      return {
        select: () => ({
          eq: async (col: string, val: string) => {
            seen.col = col;
            seen.val = val;
            return { data: rows, error };
          },
        }),
      };
    },
  };
  return { client: client as any, seen };
}

describe("writeQueryLog", () => {
  it("query_logs に、決まった列で書き込む", async () => {
    const { client, calls } = fakeInsertClient({ error: null });
    await writeQueryLog(client, {
      userId: "u1",
      userDepartment: "人事",
      query: "質問",
      retrievedChunkIds: ["c1", "c2"],
      channel: "web",
    });
    expect(calls).toEqual([
      {
        table: "query_logs",
        row: { user_id: "u1", user_department: "人事", query: "質問", retrieved_chunk_ids: ["c1", "c2"], channel: "web" },
      },
    ]);
  });

  it("書き込みに失敗したら、AuditError を投げる(ログに残らない回答を出さないため)", async () => {
    const { client } = fakeInsertClient({ error: { message: "boom" } });
    const p = writeQueryLog(client, { userId: "u1", userDepartment: null, query: "q", retrievedChunkIds: [], channel: "web" });
    await expect(p).rejects.toBeInstanceOf(AuditError);
    await expect(p).rejects.toThrow(/回答を止めました/);
  });
});

describe("departmentsOf", () => {
  it("所属部署を、並べ替えて「、」でつなぐ", async () => {
    const { client, seen } = fakeSelectClient([{ department: "人事" }, { department: "IT" }]);
    expect(await departmentsOf(client, "u1")).toBe("IT、人事");
    expect(seen).toEqual({ table: "kb_user_departments", col: "user_id", val: "u1" });
  });
  it("どの部署にも入っていなければ null", async () => {
    expect(await departmentsOf(fakeSelectClient([]).client, "u1")).toBeNull();
    expect(await departmentsOf(fakeSelectClient(null).client, "u1")).toBeNull();
  });
  it("読み込みでエラーが出ても、質問は止めずに null を返す", async () => {
    expect(await departmentsOf(fakeSelectClient(null, { message: "x" }).client, "u1")).toBeNull();
  });
});

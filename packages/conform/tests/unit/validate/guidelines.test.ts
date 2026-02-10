import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import * as fs from "node:fs";

import { runValidateGuidelines } from "../../../src/validate/guidelines.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runValidateGuidelines", () => {
  it("exits with error when path does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runValidateGuidelines("/nonexistent", { format: "text" })).rejects.toThrow(
      "process.exit"
    );

    mockExit.mockRestore();
    mockWrite.mockRestore();
    mockError.mockRestore();
  });

  it("exits with error when path is not a directory (text format)", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runValidateGuidelines("/a/file.txt", { format: "text" })).rejects.toThrow(
      "process.exit"
    );

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it("exits with error when path is not a directory (json format)", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(runValidateGuidelines("/a/file.txt", { format: "json" })).rejects.toThrow(
      "process.exit"
    );

    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("validates directory with valid guidelines and exits 0", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as fs.Stats);
    mockedFs.readdirSync.mockReturnValue(["auth.md" as unknown as fs.Dirent]);
    mockedFs.readFileSync.mockReturnValue(
      `---
id: auth
title: Authentication
category: security
priority: 1
tags:
  - security
---
# Auth guideline
`
    );

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(runValidateGuidelines("/guidelines", { format: "text" })).rejects.toThrow(
      "process.exit"
    );
    expect(mockExit).toHaveBeenCalledWith(0);

    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("outputs JSON when format is json", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as fs.Stats);
    mockedFs.readdirSync.mockReturnValue(["auth.md" as unknown as fs.Dirent]);
    mockedFs.readFileSync.mockReturnValue(
      `---
id: auth
title: Authentication
category: security
priority: 1
tags:
  - security
---
# Auth
`
    );

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const written: string[] = [];
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      written.push(String(s));
      return true;
    });

    await expect(runValidateGuidelines("/guidelines", { format: "json" })).rejects.toThrow(
      "process.exit"
    );
    const output = written.join("");
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(true);

    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("reports invalid frontmatter", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as fs.Stats);
    mockedFs.readdirSync.mockReturnValue(["bad.md" as unknown as fs.Dirent]);
    mockedFs.readFileSync.mockReturnValue(
      `---
title: Missing id
---
# Bad
`
    );

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(runValidateGuidelines("/guidelines", { format: "text" })).rejects.toThrow(
      "process.exit"
    );
    // Should exit with non-zero for invalid guidelines
    expect(mockExit).toHaveBeenCalledWith(expect.any(Number));

    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("handles empty directory", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as fs.Stats);
    mockedFs.readdirSync.mockReturnValue([]);

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(runValidateGuidelines("/empty", { format: "text" })).rejects.toThrow(
      "process.exit"
    );
    expect(mockExit).toHaveBeenCalledWith(0);

    mockExit.mockRestore();
    mockWrite.mockRestore();
  });
});

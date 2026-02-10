vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import {
  RemoteFetcherError,
  parseRepoString,
  isGhAvailable,
  verifyRepoAccess,
  checkRemoteFiles,
  standardFileChecks,
} from "../../../../src/process/scan/remote-fetcher.js";

const mockedExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseRepoString", () => {
  it("parses valid owner/repo string", () => {
    const result = parseRepoString("acme/my-app");
    expect(result).toEqual({ owner: "acme", repo: "my-app" });
  });

  it("throws RemoteFetcherError for string without slash", () => {
    expect(() => parseRepoString("invalid")).toThrow(RemoteFetcherError);
    expect(() => parseRepoString("invalid")).toThrow(/Invalid repository format/);
  });

  it("throws for string with too many slashes", () => {
    expect(() => parseRepoString("a/b/c")).toThrow(RemoteFetcherError);
  });

  it("throws for empty string", () => {
    expect(() => parseRepoString("")).toThrow(RemoteFetcherError);
  });

  it("throws for string with empty owner", () => {
    expect(() => parseRepoString("/repo")).toThrow(RemoteFetcherError);
  });

  it("throws for string with empty repo", () => {
    expect(() => parseRepoString("owner/")).toThrow(RemoteFetcherError);
  });

  it("sets error code to INVALID_REPO", () => {
    try {
      parseRepoString("bad");
    } catch (e) {
      expect((e as RemoteFetcherError).code).toBe("INVALID_REPO");
    }
  });
});

describe("isGhAvailable", () => {
  it("returns true when gh --version succeeds", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "gh version 2.0.0" } as never);
    const result = await isGhAvailable();
    expect(result).toBe(true);
    expect(mockedExeca).toHaveBeenCalledWith("gh", ["--version"]);
  });

  it("returns false when gh --version fails", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("command not found"));
    const result = await isGhAvailable();
    expect(result).toBe(false);
  });
});

describe("verifyRepoAccess", () => {
  it("returns true when API call succeeds", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const result = await verifyRepoAccess({ owner: "acme", repo: "app" });
    expect(result).toBe(true);
    expect(mockedExeca).toHaveBeenCalledWith("gh", ["api", "repos/acme/app"]);
  });

  it("throws NO_REPO error for 404 response", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("404 Not Found"));
    await expect(verifyRepoAccess({ owner: "acme", repo: "missing" })).rejects.toThrow(
      RemoteFetcherError
    );
    try {
      await verifyRepoAccess({ owner: "acme", repo: "missing" });
    } catch (e) {
      expect((e as RemoteFetcherError).code).toBe("NO_REPO");
    }
  });

  it("throws NO_PERMISSION error for 403 response", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("403 Forbidden"));
    await expect(verifyRepoAccess({ owner: "acme", repo: "private" })).rejects.toThrow(
      RemoteFetcherError
    );
    try {
      await verifyRepoAccess({ owner: "acme", repo: "private" });
    } catch (e) {
      expect((e as RemoteFetcherError).code).toBe("NO_PERMISSION");
    }
  });

  it("throws NO_PERMISSION error for 401 response", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("401 Unauthorized"));
    try {
      await verifyRepoAccess({ owner: "acme", repo: "app" });
    } catch (e) {
      expect((e as RemoteFetcherError).code).toBe("NO_PERMISSION");
    }
  });

  it("throws API_ERROR for other errors", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("network timeout"));
    try {
      await verifyRepoAccess({ owner: "acme", repo: "app" });
    } catch (e) {
      expect((e as RemoteFetcherError).code).toBe("API_ERROR");
    }
  });
});

describe("checkRemoteFiles", () => {
  it("returns exists true when primary path exists", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const results = await checkRemoteFiles({ owner: "acme", repo: "app" }, [
      { path: "README.md", required: true, description: "Readme" },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].exists).toBe(true);
    expect(results[0].path).toBe("README.md");
  });

  it("checks alternative paths when primary path not found", async () => {
    mockedExeca
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ stdout: "{}" } as never);
    const results = await checkRemoteFiles({ owner: "acme", repo: "app" }, [
      {
        path: "CODEOWNERS",
        alternativePaths: [".github/CODEOWNERS"],
        required: true,
        description: "Codeowners",
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].exists).toBe(true);
    expect(results[0].checkedPaths).toEqual(["CODEOWNERS", ".github/CODEOWNERS"]);
  });

  it("returns exists false when no path exists", async () => {
    mockedExeca.mockRejectedValue(new Error("404"));
    const results = await checkRemoteFiles({ owner: "acme", repo: "app" }, [
      {
        path: "CODEOWNERS",
        alternativePaths: [".github/CODEOWNERS"],
        required: true,
        description: "Codeowners",
      },
    ]);
    expect(results[0].exists).toBe(false);
  });

  it("checks multiple files in parallel", async () => {
    mockedExeca
      .mockResolvedValueOnce({ stdout: "{}" } as never)
      .mockResolvedValueOnce({ stdout: "{}" } as never);
    const results = await checkRemoteFiles({ owner: "acme", repo: "app" }, [
      { path: "README.md", required: true, description: "Readme" },
      { path: "LICENSE", required: true, description: "License" },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].exists).toBe(true);
    expect(results[1].exists).toBe(true);
  });
});

describe("standardFileChecks", () => {
  it("includes expected standard files", () => {
    const paths = standardFileChecks.map((c) => c.path);
    expect(paths).toContain("CODEOWNERS");
    expect(paths).toContain(".github/PULL_REQUEST_TEMPLATE.md");
    expect(paths).toContain("README.md");
    expect(paths).toContain(".github/workflows");
  });

  it("marks all standard files as not required", () => {
    for (const check of standardFileChecks) {
      expect(check.required).toBe(false);
    }
  });
});

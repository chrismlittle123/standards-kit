import { describe, it, expect, vi, beforeEach } from "vitest";

import { createClientFactory, createClientFactoryWithConfig } from "../../../../src/infra/checkers/client-factory.js";

beforeEach(() => vi.clearAllMocks());

describe("createClientFactory", () => {
  it("creates a new client for a given region", () => {
    const MockClient = vi.fn();
    const getClient = createClientFactory(MockClient);

    const client = getClient("us-east-1");

    expect(MockClient).toHaveBeenCalledWith({ region: "us-east-1" });
    expect(client).toBeInstanceOf(MockClient);
  });

  it("returns the cached client for the same region", () => {
    const MockClient = vi.fn();
    const getClient = createClientFactory(MockClient);

    const first = getClient("us-east-1");
    const second = getClient("us-east-1");

    expect(MockClient).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("creates separate clients for different regions", () => {
    const MockClient = vi.fn();
    const getClient = createClientFactory(MockClient);

    const east = getClient("us-east-1");
    const west = getClient("us-west-2");

    expect(MockClient).toHaveBeenCalledTimes(2);
    expect(east).not.toBe(west);
  });
});

describe("createClientFactoryWithConfig", () => {
  it("creates a client using the provided factory function", () => {
    const clientInstance = { id: "mock" };
    const factory = vi.fn().mockReturnValue(clientInstance);
    const getClient = createClientFactoryWithConfig(factory);

    const client = getClient("eu-west-1");

    expect(factory).toHaveBeenCalledWith("eu-west-1");
    expect(client).toBe(clientInstance);
  });

  it("returns the cached client for the same region", () => {
    const clientInstance = { id: "mock" };
    const factory = vi.fn().mockReturnValue(clientInstance);
    const getClient = createClientFactoryWithConfig(factory);

    const first = getClient("eu-west-1");
    const second = getClient("eu-west-1");

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("creates separate clients for different regions", () => {
    const factory = vi.fn().mockImplementation((region: string) => ({ region }));
    const getClient = createClientFactoryWithConfig(factory);

    const east = getClient("us-east-1");
    const west = getClient("us-west-2");

    expect(factory).toHaveBeenCalledTimes(2);
    expect(east).not.toBe(west);
  });
});

export type HubSkillEntry = {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category?: string;
  downloads: number;
  rating: number;
  publishedAt: string;
  dependencies?: { slug: string; version: string }[];
};

export type HubSearchResult = {
  skills: HubSkillEntry[];
  total: number;
};

export type HubPublishResult = {
  slug: string;
  version: string;
  url: string;
};

export type HubLoginChallenge = {
  challenge: string;
  expiresAt: string;
};

export type HubIdentity = {
  id: string;
  name: string;
  publicKey: string;
  registeredAt: string;
};

export class HubClient {
  private authToken?: string;

  constructor(private hubUrl: string) {}

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  getAuthToken(): string | undefined {
    return this.authToken;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.hubUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errorBody: string;
      try {
        errorBody = await res.text();
      } catch {
        errorBody = `HTTP ${res.status}`;
      }
      throw new Error(`Hub ${method} ${path} failed: ${res.status} — ${errorBody}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  async search(
    query: string,
    options?: { category?: string; limit?: number },
  ): Promise<HubSearchResult> {
    const params = new URLSearchParams({ q: query });
    if (options?.category) params.set("category", options.category);
    if (options?.limit) params.set("limit", String(options.limit));
    return this.request("GET", `/api/v1/skills/search?${params}`);
  }

  async getSkill(slug: string, version?: string): Promise<HubSkillEntry> {
    const path = version
      ? `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`
      : `/api/v1/skills/${encodeURIComponent(slug)}`;
    return this.request("GET", path);
  }

  async download(slug: string, version?: string): Promise<Buffer> {
    const path = version
      ? `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/download`
      : `/api/v1/skills/${encodeURIComponent(slug)}/download`;

    const url = `${this.hubUrl}${path}`;
    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Hub download failed: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async publish(
    slug: string,
    archive: Buffer,
    metadata: {
      name: string;
      description: string;
      version: string;
      changelog?: string;
      signature: string;
      dependencies?: { slug: string; version: string }[];
    },
  ): Promise<HubPublishResult> {
    return this.request("POST", `/api/v1/skills/${encodeURIComponent(slug)}/publish`, {
      archive: archive.toString("base64"),
      ...metadata,
    });
  }

  async requestLoginChallenge(publicKey: string): Promise<HubLoginChallenge> {
    return this.request("POST", "/api/v1/auth/challenge", { publicKey });
  }

  async submitLoginResponse(
    publicKey: string,
    challenge: string,
    signature: string,
  ): Promise<{ token: string }> {
    return this.request("POST", "/api/v1/auth/login", {
      publicKey,
      challenge,
      signature,
    });
  }

  async whoami(): Promise<HubIdentity> {
    return this.request("GET", "/api/v1/auth/me");
  }

  async getSkillVersions(slug: string): Promise<{ versions: HubSkillEntry[] }> {
    return this.request("GET", `/api/v1/skills/${encodeURIComponent(slug)}/versions`);
  }
}

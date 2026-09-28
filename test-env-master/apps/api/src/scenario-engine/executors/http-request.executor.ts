import { maskDeep } from "../../common/mask.util";
import { bindRequest, captureResponse } from "../auto-bind";
import type { ExecutionContext, StepExecutionResult, StepExecutor } from "../types";

function assertSafeUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsafe URL protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (host === "metadata.google.internal" || host === "169.254.169.254") {
    throw new Error(`SSRF protection blocked host: ${host}`);
  }
  if (process.env.HTTP_BLOCK_PRIVATE === "true") {
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      throw new Error(`SSRF protection blocked private host: ${host}`);
    }
  }
  return url;
}

export class HttpRequestExecutor implements StepExecutor {
  readonly type = "HTTP_REQUEST";

  async execute(
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<StepExecutionResult> {
    if (context.isCancelled()) {
      return { status: "CANCELLED", error: "Cancelled before HTTP request" };
    }

    const resolved = context.interpolateDeep(bindRequest(config, context)) as {
      method?: string;
      url: string;
      headers?: Record<string, string>;
      query?: Record<string, string>;
      body?: unknown;
      timeoutMs?: number;
    };

    const method = (resolved.method ?? "GET").toUpperCase();
    const url = assertSafeUrl(resolved.url);
    if (resolved.query) {
      for (const [k, v] of Object.entries(resolved.query)) {
        url.searchParams.set(k, v);
      }
    }

    const timeoutMs = Math.min(Math.max(resolved.timeoutMs ?? 15000, 1000), 60000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const unsubscribe = context.onAbort(() => controller.abort());

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: resolved.headers,
        body:
          resolved.body === undefined || method === "GET" || method === "HEAD"
            ? undefined
            : typeof resolved.body === "string"
              ? resolved.body
              : JSON.stringify(resolved.body),
        signal: controller.signal,
        redirect: "manual",
      });

      if (context.isCancelled()) {
        return { status: "CANCELLED", error: "Cancelled during HTTP request" };
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        throw new Error(`Redirects are not followed (status ${response.status})`);
      }

      const rawBody = await response.text();
      if (rawBody.length > 1_000_000) {
        throw new Error("Response too large (>1MB)");
      }

      let body: unknown = rawBody;
      try {
        body = JSON.parse(rawBody);
      } catch {
        // keep text
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      context.lastHttpResponse = {
        status: response.status,
        headers,
        body,
        rawBody,
      };
      const learned = captureResponse(body, context);

      return {
        status: "PASSED",
        extractedVars: Object.keys(learned).length ? learned : undefined,
        resolvedInput: maskDeep({
          method,
          url: url.toString(),
          headers: resolved.headers,
          query: resolved.query,
          body: resolved.body,
        }),
        output: maskDeep({
          status: response.status,
          headers,
          body,
        }),
      };
    } catch (error) {
      if (context.isCancelled() || (error instanceof Error && error.name === "AbortError")) {
        return {
          status: "CANCELLED",
          resolvedInput: maskDeep({
            method,
            url: resolved.url,
            headers: resolved.headers,
          }),
          error: "Cancelled during HTTP request",
        };
      }
      return {
        status: "FAILED",
        resolvedInput: maskDeep({
          method,
          url: resolved.url,
          headers: resolved.headers,
        }),
        error: error instanceof Error ? error.message : "HTTP request failed",
      };
    } finally {
      clearTimeout(timer);
      unsubscribe();
    }
  }
}

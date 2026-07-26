export interface LafetchReadableStream<T> extends ReadableStream<T> {
  /**
   * Consume chunks sequentially while preserving Web Stream backpressure.
   * The returned Promise settles when the Stream completes or fails.
   */
  forEach(
    handler: (chunk: T, index: number) => void | PromiseLike<void>,
  ): Promise<void>;
}

export interface LafetchStreamResponse extends Response {
  /** Access the live byte Stream without nullable body handling. */
  pipe(): LafetchReadableStream<Uint8Array>;
  /** Decode the live byte Stream as text. */
  pipe(mode: "text", options?: StreamPipeOptions): LafetchReadableStream<string>;
  /** Pass the live byte Stream through a standard Web Stream transform. */
  pipe<T>(
    transform: ReadableWritablePair<T, Uint8Array>,
    options?: StreamPipeOptions,
  ): LafetchReadableStream<T>;
  clone(): LafetchStreamResponse;
}

async function consumeStream<T>(
  this: ReadableStream<T>,
  handler: (chunk: T, index: number) => void | PromiseLike<void>,
): Promise<void> {
  if (typeof handler !== "function") {
    throw new TypeError("forEach() requires a chunk handler.");
  }
  const reader = this.getReader();
  let index = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      await handler(chunk.value, index++);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch { /* preserve the read or handler failure */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function withConsumer<T>(stream: ReadableStream<T>): LafetchReadableStream<T> {
  if (!Object.hasOwn(stream, "forEach")) {
    Object.defineProperty(stream, "forEach", { value: consumeStream });
  }
  return stream as LafetchReadableStream<T>;
}

function emptyByteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

function pipeStream(
  this: Response,
  transform?: "text" | ReadableWritablePair<unknown, Uint8Array>,
  options?: StreamPipeOptions,
): LafetchReadableStream<unknown> {
  const body = this.body ?? emptyByteStream();
  if (transform === undefined) return withConsumer(body);
  if (transform === "text") {
    return withConsumer(body.pipeThrough(
      new TextDecoderStream() as ReadableWritablePair<string, Uint8Array>,
      options,
    ));
  }
  return withConsumer(body.pipeThrough(transform, options));
}

/** @internal */
export function withStreamConvenience(response: Response): LafetchStreamResponse {
  Object.defineProperty(response, "pipe", { value: pipeStream });
  return response as LafetchStreamResponse;
}

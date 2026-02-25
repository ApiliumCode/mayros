/**
 * QuickJS ↔ JS marshaling helpers.
 *
 * Converts between native JS values and QuickJS handles for use
 * in the QuickJS WASM sandbox.
 */

import type { QuickJSAsyncContext, QuickJSHandle } from "quickjs-emscripten";

/**
 * Marshal a native JS value into a QuickJS handle.
 * Supports: null, undefined, string, number, boolean, arrays, plain objects.
 * All created handles must be disposed by the caller (or managed via scope).
 */
export function marshalToQuickJS(ctx: QuickJSAsyncContext, value: unknown): QuickJSHandle {
  if (value === null || value === undefined) return ctx.undefined;
  if (typeof value === "string") return ctx.newString(value);
  if (typeof value === "number") return ctx.newNumber(value);
  if (typeof value === "boolean") return value ? ctx.true : ctx.false;

  if (Array.isArray(value)) {
    const arr = ctx.newArray();
    for (let i = 0; i < value.length; i++) {
      const elem = marshalToQuickJS(ctx, value[i]);
      ctx.setProp(arr, i, elem);
      if (typeof value[i] !== "boolean") elem.dispose();
    }
    return arr;
  }

  if (typeof value === "object") {
    const obj = ctx.newObject();
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const propHandle = marshalToQuickJS(ctx, val);
      ctx.setProp(obj, key, propHandle);
      if (typeof val !== "boolean") propHandle.dispose();
    }
    return obj;
  }

  return ctx.undefined;
}

/**
 * Unmarshal a QuickJS handle into a native JS value.
 * Uses ctx.dump() which handles all QuickJS types.
 */
export function marshalFromQuickJS(ctx: QuickJSAsyncContext, handle: QuickJSHandle): unknown {
  return ctx.dump(handle);
}

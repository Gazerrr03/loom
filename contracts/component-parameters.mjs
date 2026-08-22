import { createHash } from "node:crypto";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function assertSchemaNode(schema, path) {
  if (!isRecord(schema)) throw new Error(`${path} must be a parameter schema object`);
  const supportedTypes = new Set(["object", "array", "string", "number", "integer", "boolean"]);
  if (schema.type !== undefined && !supportedTypes.has(schema.type)) {
    throw new Error(`${path}.type is unsupported: ${String(schema.type)}`);
  }
  if (schema.type === "object") {
    if (schema.properties !== undefined && !isRecord(schema.properties)) {
      throw new Error(`${path}.properties must be an object`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      assertSchemaNode(child, `${path}.properties.${key}`);
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string"))) {
      throw new Error(`${path}.required must contain parameter names`);
    }
  }
  if (schema.type === "array" && schema.items !== undefined) assertSchemaNode(schema.items, `${path}.items`);
  if (schema.minimum !== undefined && typeof schema.minimum !== "number") throw new Error(`${path}.minimum must be a number`);
  if (schema.maximum !== undefined && typeof schema.maximum !== "number") throw new Error(`${path}.maximum must be a number`);
  if (schema.minLength !== undefined && (!Number.isInteger(schema.minLength) || schema.minLength < 0)) {
    throw new Error(`${path}.minLength must be a non-negative integer`);
  }
}

function validateValue(value, schema, path) {
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.some((candidate) => Object.is(candidate, value)))) {
    throw new Error(`${path} must match one of the declared enum values`);
  }
  switch (schema.type) {
    case "object": {
      if (!isRecord(value)) throw new Error(`${path} must be an object`);
      const properties = schema.properties ?? {};
      for (const key of schema.required ?? []) {
        if (!(key in value)) throw new Error(`${path}.${key} is required`);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) throw new Error(`${path}.${key} is not an accepted parameter`);
        }
      }
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in value) validateValue(value[key], childSchema, `${path}.${key}`);
      }
      return;
    }
    case "array":
      if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
      if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`));
      return;
    case "string":
      if (typeof value !== "string") throw new Error(`${path} must be a string`);
      if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${path} is shorter than minLength`);
      return;
    case "integer":
      if (!Number.isInteger(value)) throw new Error(`${path} must be an integer`);
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
      break;
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
      return;
    default:
      if (schema.type !== undefined) throw new Error(`${path}.type is unsupported`);
      return;
  }
  if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${path} must be >= ${schema.minimum}`);
  if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${path} must be <= ${schema.maximum}`);
}

export function assertParameterContract(manifest) {
  if (!isRecord(manifest)) throw new TypeError("component manifest must be an object");
  assertSchemaNode(manifest.parametersSchema, "parametersSchema");
  if (!isRecord(manifest.defaults)) throw new Error("defaults must be an object");
  validateValue(manifest.defaults, manifest.parametersSchema, "defaults");
  return manifest;
}

function mergeDefaults(defaults, value) {
  if (!isRecord(defaults) || !isRecord(value)) return clone(value);
  const merged = { ...clone(defaults) };
  for (const [key, child] of Object.entries(value)) {
    merged[key] = isRecord(merged[key]) && isRecord(child) ? mergeDefaults(merged[key], child) : clone(child);
  }
  return merged;
}

export function resolveParameters(manifest, input = {}) {
  assertParameterContract(manifest);
  if (!isRecord(input)) throw new Error("parameter input must be an object");
  const resolved = mergeDefaults(manifest.defaults, input);
  validateValue(resolved, manifest.parametersSchema, "parameters");
  return resolved;
}

export function parameterFingerprint(manifest, input = {}) {
  const resolved = resolveParameters(manifest, input);
  const bytes = JSON.stringify(canonicalize(resolved));
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const fs = require('fs');
const path = require('path');

const openapiPath = path.resolve(__dirname, 'openapi.json');
const outputPath = path.resolve(__dirname, 'openapi.d.ts');

const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
const schemas = openapi.components?.schemas || {};

function refName(ref) {
  return ref.split('/').pop();
}

function tsType(schema) {
  if (!schema) {
    return 'unknown';
  }
  if (schema.$ref) {
    return refName(schema.$ref);
  }
  if (schema.allOf) {
    return schema.allOf.map(tsType).join(' & ');
  }
  if (schema.oneOf) {
    return schema.oneOf.map(tsType).join(' | ');
  }
  if (schema.anyOf) {
    return schema.anyOf.map(tsType).join(' | ');
  }
  if (schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  }
  let type = 'unknown';
  const schemaType = schema.type;
  if (schemaType === 'string') {
    type = 'string';
  } else if (schemaType === 'integer' || schemaType === 'number') {
    type = 'number';
  } else if (schemaType === 'boolean') {
    type = 'boolean';
  } else if (schemaType === 'array') {
    type = `${tsType(schema.items)}[]`;
  } else if (schemaType === 'object' || schema.properties) {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    const keys = Object.keys(props);
    if (keys.length === 0 && !schema.additionalProperties) {
      type = 'Record<string, unknown>';
    } else {
      const lines = keys.map((key) => {
        const safeKey = /^[a-zA-Z_$][\\w$]*$/.test(key) ? key : JSON.stringify(key);
        const optional = required.has(key) ? '' : '?';
        return `  ${safeKey}${optional}: ${tsType(props[key])};`;
      });
      if (schema.additionalProperties) {
        const addType =
          schema.additionalProperties === true
            ? 'unknown'
            : tsType(schema.additionalProperties);
        lines.push(`  [key: string]: ${addType};`);
      }
      type = `{\n${lines.join('\n')}\n}`;
    }
  }
  if (schema.nullable) {
    type = `${type} | null`;
  }
  return type;
}

const header = `/* Auto-generated from openapi.json. */\n\n`;
const body = Object.entries(schemas)
  .map(([name, schema]) => `export type ${name} = ${tsType(schema)};`)
  .join('\n\n');

fs.writeFileSync(outputPath, `${header}${body}\n`);
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);

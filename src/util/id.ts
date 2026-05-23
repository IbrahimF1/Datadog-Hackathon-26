import { randomUUID } from "node:crypto";

export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

export const now = (): string => new Date().toISOString();

/**
 * Input Validation & Sanitization (M3)
 *
 * Security utilities to prevent XSS, injection attacks, and invalid input.
 */

export function sanitizeInput(input: string): string {
  // Remove potentially dangerous characters
  return input
    .replace(/[<>\"'&]/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "");
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

export function validateWorkspaceId(id: string): boolean {
  // UUID v4 format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export function validateUserId(id: string): boolean {
  // Same as workspace ID (both are UUIDs)
  return validateWorkspaceId(id);
}

export function validateAgentId(id: string): boolean {
  // Alphanumeric + hyphens/underscores, max 64 chars
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

export function validateSessionId(id: string): boolean {
  // Similar to agent ID
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow http/https
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export interface ValidationError {
  field: string;
  message: string;
}

export class InputValidator {
  private errors: ValidationError[] = [];

  requireString(value: unknown, field: string, maxLength = 1000): string | null {
    if (typeof value !== "string") {
      this.errors.push({ field, message: "must be a string" });
      return null;
    }
    if (value.length === 0) {
      this.errors.push({ field, message: "cannot be empty" });
      return null;
    }
    if (value.length > maxLength) {
      this.errors.push({ field, message: `exceeds max length of ${maxLength}` });
      return null;
    }
    return value;
  }

  requireEmail(value: unknown, field: string): string | null {
    const str = this.requireString(value, field, 254);
    if (!str) return null;

    if (!validateEmail(str)) {
      this.errors.push({ field, message: "invalid email format" });
      return null;
    }
    return str;
  }

  requireUuid(value: unknown, field: string): string | null {
    const str = this.requireString(value, field, 36);
    if (!str) return null;

    if (!validateWorkspaceId(str)) {
      this.errors.push({ field, message: "invalid UUID format" });
      return null;
    }
    return str;
  }

  getErrors(): ValidationError[] {
    return this.errors;
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  throwIfErrors(): void {
    if (this.hasErrors()) {
      const messages = this.errors.map((e) => `${e.field}: ${e.message}`).join(", ");
      throw new Error(`Validation failed: ${messages}`);
    }
  }
}

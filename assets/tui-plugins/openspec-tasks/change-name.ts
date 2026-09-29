export const CHANGE_NAME_MAX_LENGTH = 255;

const CHANGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isValidChangeName(value: string): boolean {
  return (
    value.length <= CHANGE_NAME_MAX_LENGTH && CHANGE_NAME_PATTERN.test(value)
  );
}

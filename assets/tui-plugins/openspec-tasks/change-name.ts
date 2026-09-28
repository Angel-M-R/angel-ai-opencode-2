export const CHANGE_NAME_MAX_LENGTH = 100;

const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function isValidChangeName(value: string): boolean {
  return (
    value.length <= CHANGE_NAME_MAX_LENGTH && CHANGE_NAME_PATTERN.test(value)
  );
}

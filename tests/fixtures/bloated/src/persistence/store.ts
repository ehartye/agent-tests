export const save = (key: string, value: string): string => `${key}=${value}`;
export const load = (entry: string): string => entry.split('=')[1];

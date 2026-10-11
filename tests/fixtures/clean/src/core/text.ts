export const slug = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, '-');
export const total = (items: number[]): number => items.reduce((sum, item) => sum + item, 0);

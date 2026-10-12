export const send = (transport: (message: string) => void, message: string): void => transport(message);

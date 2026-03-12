import { vi, beforeEach, afterEach } from 'vitest';

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(() => {
  exitSpy.mockRestore();
});

export type Logger = {
  push: (msg: string) => void;
  clear: () => void;
};

export function makeStateLogger(setLogs: React.Dispatch<React.SetStateAction<string[]>>): Logger {
  return {
    push: (msg: string) => {
      setLogs((prev) => [...prev, msg]);
      console.log(msg);
    },
    clear: () => setLogs([]),
  };
}

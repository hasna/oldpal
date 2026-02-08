import { useEffect } from 'react';
import { useStdin, type Key } from 'ink';
import parseKeypress, { nonAlphanumericKeys } from 'ink/build/parse-keypress.js';

type Handler = (input: string, key: Key) => void;
type Options = { isActive?: boolean };

// Input hook that avoids toggling raw mode off when handlers deactivate.
export function useSafeInput(handler: Handler, options: Options = {}): void {
  const { internal_eventEmitter, internal_exitOnCtrlC, setRawMode, isRawModeSupported } = useStdin() as {
    internal_eventEmitter?: NodeJS.EventEmitter;
    internal_exitOnCtrlC?: boolean;
    setRawMode?: (isEnabled: boolean) => void;
    isRawModeSupported?: boolean;
  };

  useEffect(() => {
    if (!isRawModeSupported || !setRawMode) return;
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [isRawModeSupported, setRawMode]);

  useEffect(() => {
    if (options.isActive === false) return;
    if (!internal_eventEmitter) return;

    const handleData = (data: string) => {
      const keypress = parseKeypress(data);
      const key = {
        upArrow: keypress.name === 'up',
        downArrow: keypress.name === 'down',
        leftArrow: keypress.name === 'left',
        rightArrow: keypress.name === 'right',
        pageDown: keypress.name === 'pagedown',
        pageUp: keypress.name === 'pageup',
        home: keypress.name === 'home',
        end: keypress.name === 'end',
        return: keypress.name === 'return',
        escape: keypress.name === 'escape',
        ctrl: keypress.ctrl,
        shift: keypress.shift,
        tab: keypress.name === 'tab',
        backspace: keypress.name === 'backspace',
        delete: keypress.name === 'delete',
        meta: keypress.meta || keypress.name === 'escape' || keypress.option,
      };

      let input = keypress.ctrl ? keypress.name : keypress.sequence;
      if (nonAlphanumericKeys.includes(keypress.name)) {
        input = '';
      }
      if (input.startsWith('\u001B')) {
        input = input.slice(1);
      }
      if (input.length === 1 && typeof input[0] === 'string' && /[A-Z]/.test(input[0])) {
        key.shift = true;
      }

      if (!(input === 'c' && key.ctrl) || !internal_exitOnCtrlC) {
        handler(input, key);
      }
    };

    internal_eventEmitter.on('input', handleData);
    return () => {
      internal_eventEmitter.removeListener('input', handleData);
    };
  }, [handler, internal_eventEmitter, internal_exitOnCtrlC, options.isActive]);
}

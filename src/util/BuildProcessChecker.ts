import { LoggerWrapper } from '../LoggerWrapper';
import find_process = require('find-process');

///

// not so nice, init in rootsuite in the future
export class BuildProcessChecker {
  constructor(private readonly _log: LoggerWrapper) {}

  private readonly _checkIntervalMillis = 2000;
  // https://en.wikipedia.org/wiki/List_of_compilers#C++_compilers
  private readonly _defaultPattern =
    /(^|[/\\])(cmake|make|ninja|cl|c\+\+|ld|clang|clang\+\+|gcc|g\+\+|link|icc|armcc|armclang)(-[^/\\]+)?(\.exe)?$/;
  private _lastChecked = 0;
  private _finishedP = Promise.resolve();
  private _finishedResolver = (): void => {}; // eslint-disable-line
  private _timerId: NodeJS.Timeout | undefined = undefined; // number if have running build process

  dispose(): void {
    this._timerId && clearInterval(this._timerId);
    this._finishedResolver();
  }

  resolveAtFinish(pattern: string | undefined): Promise<void> {
    if (this._timerId !== undefined) {
      return this._finishedP;
    }

    const elapsed = Date.now() - this._lastChecked;

    if (elapsed < 300) {
      return Promise.resolve();
    }

    this._finishedP = new Promise(r => {
      this._finishedResolver = r;
    });

    this._log.info('Checking running build related processes');
    const patternToUse = pattern ? RegExp(pattern) : this._defaultPattern;
    this._timerId = global.setInterval(this._refresh.bind(this, patternToUse), this._checkIntervalMillis);
    this._refresh(patternToUse);

    return this._finishedP;
  }

  private async _refresh(pattern: RegExp): Promise<void> {
    try {
      const processes = await find_process('name', pattern);

      this._lastChecked = Date.now();

      if (processes.length > 0) {
        this._log.info(
          'Found running build related processes: ' + processes.map(x => JSON.stringify(x, undefined, 0)).join(', '),
        );
      } else {
        this._log.info('Not found running build related process');
        this._finishedResolver();
        clearInterval(this._timerId!);
        this._timerId = undefined;
      }
    } catch (reason) {
      this._log.exceptionS(reason);
      clearInterval(this._timerId!);
      this._timerId = undefined;
      this._finishedResolver();
    }
  }
}

import * as vscode from 'vscode';
import * as ansi from 'ansi-colors';

import { AbstractExecutable as AbstractExecutable, HandleProcessResult } from '../AbstractExecutable';
import { TaefBinaryTest } from './TaefBinaryTest';
import { SharedVarOfExec } from '../SharedVarOfExec';
import { RunningExecutable } from '../../RunningExecutable';
import { AbstractTest } from '../AbstractTest';
import { CancellationToken } from '../../Util';
import { TestGroupingConfig } from '../../TestGroupingInterface';
import { TestResultBuilder } from '../../TestResultBuilder';
import { LambdaLineProcessor, LineProcessor, NoOpLineProcessor, TextStreamParser } from '../../util/TextStreamParser';
import { TestItemParent } from '../../TestItemManager';
import { pipeOutputStreams2String, pipeProcess2Parser } from '../../util/ParserInterface';

export class TaefBinaryExecutable extends AbstractExecutable<TaefBinaryTest> {
  private _testSuites = new Map<string, string[]>();

  constructor(sharedVarOfExec: SharedVarOfExec) {
    super(sharedVarOfExec, 'TAEF', undefined);
  }

  private getTestGrouping(): TestGroupingConfig {
    if (this.shared.testGrouping) {
      return this.shared.testGrouping;
    } else {
      const grouping = { groupByExecutable: this._getGroupByExecutable() };
      grouping.groupByExecutable.groupByTags = { tags: [], tagFormat: '${tag}' };
      return grouping;
    }
  }

  private readonly _createAndAddTest = async (
    ftn: string,
    file: string | undefined,
    line: string | undefined,
    typeParam: string | undefined,
    valueParam: string | undefined,
  ): Promise<TaefBinaryTest> => {
    const resolvedFile = this.findSourceFilePath(file);
    const [suiteName, testName] = splitFullTestName(ftn);

    if (this._testSuites.has(suiteName)) {
      this._testSuites.get(suiteName)?.push(ftn);
    } else {
      this._testSuites.set(suiteName, [ftn]);
    }

    return this._createTreeAndAddTest(
      this.getTestGrouping(),
      testName,
      resolvedFile,
      line,
      [suiteName],
      undefined,
      (parent: TestItemParent) =>
        new TaefBinaryTest(this, parent, ftn, testName, suiteName, typeParam, valueParam, resolvedFile, line),
      (test: TaefBinaryTest) => test.update2(testName, suiteName, resolvedFile, line, typeParam, valueParam),
    );
  };

  protected async _reloadChildren(_: CancellationToken): Promise<void> {
    const pathForExecution = await this._getPathForExecution();
    const args = this.shared.prependTestListingArgs.concat([`/list`, pathForExecution]);

    const teExePath = this.shared.shared.taefExecutablePath!;
    this.shared.log.info('discovering tests', teExePath, pathForExecution, args, this.shared.options.cwd);
    const taefListProcess = await this.shared.spawner.spawn(teExePath, args, this.shared.options);

    try {
      const [stdout, _] = await pipeOutputStreams2String(taefListProcess.stdout, taefListProcess.stderr);

      const fullTestCaseNames = [];
      const testCaseListRe = /                (.+)$/m;
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(testCaseListRe);
        if (m) {
          const ftn = m[1];
          fullTestCaseNames.push(ftn);
        }
      }

      const testFileLines = await this.getFileLineMapping(fullTestCaseNames);
      for (const [ftn, file, line] of testFileLines) {
        await this._createAndAddTest(ftn, file, line, undefined, undefined);
      }
    } catch (e) {
      this.shared.log.warn('reloadChildren error:', e);
      return await this._createAndAddUnexpectedStdError(e.toString(), '');
    }
  }

  private async getFileLine(ftn: string): Promise<[string, string?, string?]> {
    const binaryPath = this.shared.path;
    const dbhExe = this.shared.shared.dbhExecutablePath!;
    if (!dbhExe) {
      return [ftn, undefined, undefined];
    }
    let args = [binaryPath, 'name', ftn];
    let proc = await this.shared.spawner.spawn(dbhExe, args, this.shared.options);
    let [stdout, _] = await pipeOutputStreams2String(proc.stdout, proc.stderr);
    const mAddr = stdout.match(/addr :\s{2,}([a-f0-9]+)/m);
    if (mAddr) {
      args = [binaryPath, 'laddr', mAddr[1]];
      proc = await this.shared.spawner.spawn(dbhExe, args, this.shared.options);
      [stdout, _] = await pipeOutputStreams2String(proc.stdout, proc.stderr);
      const mFile = stdout.match(/file : (.+)/m);
      const mLine = stdout.match(/line : (\d+)/m);
      if (mFile && mLine) {
        return [ftn, mFile[1], (parseInt(mLine[1]) - 1).toString()];
      }
    }
    return [ftn, undefined, undefined];
  }

  private async getFileLineMapping(fullTestNames: string[]): Promise<Array<[string, string?, string?]>> {
    const binaryPath = this.shared.path;
    const dbhExe = this.shared.shared.dbhExecutablePath!;
    if (!dbhExe) {
      return fullTestNames.map(ftn => [ftn, undefined, undefined]);
    }
    const stdinNames = fullTestNames.map(ftn => `name ${ftn}\n`).join('') + 'q\n';
    let proc = await this.shared.spawner.spawnAsync(dbhExe, [binaryPath], this.shared.options, undefined, stdinNames);
    const addresses = [];
    for (const m of proc.stdout.matchAll(/addr :\s{2,}([a-f0-9]+)/g)) {
      addresses.push(m[1]);
    }
    const stdinData = addresses.map(a => `laddr ${a}\n`).join('') + 'q\n';
    proc = await this.shared.spawner.spawnAsync(dbhExe, [binaryPath], this.shared.options, undefined, stdinData);
    const ftnFileLine: Array<[string, string?, string?]> = [];
    let i = 0;
    for (const m of proc.stdout.matchAll(/\s+file : (.+)\r?\n\s+line : (\d+)\r?\n/gm)) {
      ftnFileLine.push([fullTestNames[i++], m[1], (parseInt(m[2]) - 1).toString()]);
    }
    return ftnFileLine;
  }

  public override async getExecutablePath(_forceOriginalPath: boolean = false) {
    return this.shared.shared.taefExecutablePath!;
  }

  private _getRunParamsCommon(childrenToRun: readonly Readonly<AbstractTest>[]): string[] {
    const execParams: string[] = [this.shared.path]; // path to the DLL

    const colouring = this.shared.enableDebugColouring ? 'true' : 'false';
    execParams.push(`/coloredConsoleOutput:${colouring}`);

    if (childrenToRun.length == this._numTests()) {
      return execParams; // entire binary will be run
    }

    // count tests to run per suite to optimize test filter
    const testsPerSuite = new Map<string, string[]>();
    for (const childToRun of childrenToRun) {
      const ftn = childToRun.id;
      const [suiteName, _] = splitFullTestName(childToRun.id);
      if (testsPerSuite.has(suiteName)) {
        testsPerSuite.get(suiteName)?.push(ftn);
      } else {
        testsPerSuite.set(suiteName, [ftn]);
      }
    }
    let testFilterNames: string[] = [];
    for (const [suiteName, ftns] of testsPerSuite) {
      if (this._testSuites.get(suiteName)?.length === ftns.length) {
        testFilterNames.push(`@Name='${suiteName}*'`);
      } else {
        testFilterNames = testFilterNames.concat(ftns.map(ftn => `@Name='${ftn}'`));
      }
    }

    execParams.push(`/select:` + testFilterNames.join(' OR '));
    return execParams;
  }

  protected _getRunParamsInner(childrenToRun: readonly Readonly<AbstractTest>[]): string[] {
    return ['/isolationLevel:Test', ...this._getRunParamsCommon(childrenToRun)];
  }

  protected _getDebugParamsInner(childrenToRun: readonly Readonly<AbstractTest>[], breakOnFailure: boolean): string[] {
    const debugParams = [...this._getRunParamsCommon(childrenToRun), `/inproc`];
    if (breakOnFailure) {
      debugParams.push(`/breakOnError`);
    }
    return debugParams;
  }

  protected async _handleProcess(testRun: vscode.TestRun, runInfo: RunningExecutable): Promise<HandleProcessResult> {
    const unexpectedTests: TaefBinaryTest[] = [];
    const expectedToRunAndFoundTests: TaefBinaryTest[] = [];
    const executable = this; //eslint-disable-line
    const log = this.shared.log;
    const data = { lastBuilder: undefined as TestResultBuilder | undefined };

    const parser = new TextStreamParser(
      this.shared.log,
      {
        async online(line: string): Promise<void | LineProcessor> {
          const beginMatch = testBeginRe.exec(line);
          if (beginMatch) {
            const ftn = beginMatch[1];
            let test = executable._getTest(ftn);
            if (!test) {
              log.info('TestCase not found in children', ftn);
              const [_, file, line] = await executable.getFileLine(ftn);
              test = await executable._createAndAddTest(ftn, file, line, undefined, undefined);
              unexpectedTests.push(test);
            } else {
              expectedToRunAndFoundTests.push(test);
            }
            data.lastBuilder = new TestResultBuilder(test, testRun, runInfo.runPrefix, false);
            return new TestCaseProcessor(executable.shared, testEndRe(test.id), data.lastBuilder);
          } else if (line.startsWith('[----------] Global test environment tear-down')) {
            return executable.shared.shared.hideUninterestingOutput
              ? new NoOpLineProcessor()
              : new LambdaLineProcessor(l => testRun.appendOutput(runInfo.runPrefix + l + '\r\n'));
          } else {
            if (line === '' || ['Test Authoring and Execution Framework ', 'Summary: '].some(x => line.startsWith(x))) {
              if (executable.shared.shared.hideUninterestingOutput == false)
                testRun.appendOutput(runInfo.runPrefix + line + '\r\n');
            } else {
              testRun.appendOutput(runInfo.runPrefix + line + '\r\n');
            }
          }
        },
      },
      false,
    );

    await pipeProcess2Parser(runInfo, parser, (data: string) =>
      executable.processStdErr(testRun, runInfo.runPrefix, data),
    );

    const leftBehindBuilder = data.lastBuilder && !data.lastBuilder.built ? data.lastBuilder : undefined;

    return {
      unexpectedTests,
      expectedToRunAndFoundTests,
      leftBehindBuilder,
    };
  }
}

///
function splitFullTestName(ftn: string): [string, string] {
  const sep = ftn.includes('::') ? '::' : '.';
  const i = ftn.lastIndexOf(sep);
  const suiteName = ftn.substring(0, i);
  const testName = ftn.substring(i + sep.length);
  return [suiteName, testName];
}
///

const testBeginRe = /StartGroup: (.+)$/m;
const testEndRe = (ftn: string) => new RegExp(`EndGroup: ${ftn} \\[(Failed|Passed)\\]`);

class TestCaseSharedData {
  constructor(
    readonly shared: SharedVarOfExec,
    readonly builder: TestResultBuilder,
  ) {}

  gMockWarningCount = 0;
}

///

class TestCaseProcessor implements LineProcessor {
  constructor(
    shared: SharedVarOfExec,
    private readonly testEndRe: RegExp,
    private readonly builder: TestResultBuilder,
  ) {
    this.testCaseShared = new TestCaseSharedData(shared, builder);
    builder.started();
  }

  private startTime = performance.now();
  private readonly testCaseShared: TestCaseSharedData;

  begin(line: string): void {
    const loc = this.builder.getLocationAtStr(
      this.testCaseShared.builder.test.file,
      this.testCaseShared.builder.test.line,
      true,
    );
    this.testCaseShared.builder.addOutputLine(0, ansi.bold(line) + loc);
  }

  online(line: string): void | true | LineProcessor {
    const testEndMatch = this.testEndRe.exec(line);

    if (testEndMatch) {
      const duration = performance.now() - this.startTime;
      this.testCaseShared.builder.setDurationMilisec(duration);
      const result = testEndMatch[1];

      let styleFunc = (s: string) => s;

      if (result === 'Passed') {
        styleFunc = (s: string) => ansi.green(s);
        this.testCaseShared.builder.passed();
      } else if (result === 'Failed') {
        styleFunc = (s: string) => ansi.red.bold(s);
        this.testCaseShared.builder.failed();
      } else if (result === 'SKIPPED') {
        this.testCaseShared.builder.skipped();
      } else {
        this.testCaseShared.shared.log.error('unexpected token:', line);
        this.testCaseShared.builder.errored();
      }

      if (this.testCaseShared.gMockWarningCount) {
        this.testCaseShared.builder.addOutputLine(
          1,
          '⚠️' + this.testCaseShared.gMockWarningCount + ' GMock warning(s) in the output!',
        );
      }

      this.testCaseShared.builder.build();
      this.testCaseShared.builder.addOutputLine(0, styleFunc(result), '');
      return true;
    }
    this.testCaseShared.builder.addOutputLine(1, line);
  }
}

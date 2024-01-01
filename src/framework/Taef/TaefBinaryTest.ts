import { AbstractTest } from '../AbstractTest';
import { AbstractExecutable } from '../AbstractExecutable';
import { SharedTestTags } from '../SharedTestTags';
import { TestItemParent } from '../../TestItemManager';

export class TaefBinaryTest extends AbstractTest {
  constructor(
    executable: AbstractExecutable,
    parent: TestItemParent,
    testNameAsId: string,
    testName: string,
    suiteName: string,
    typeParam: string | undefined,
    valueParam: string | undefined,
    file: string | undefined,
    line: string | undefined,
  ) {
    super(
      executable,
      parent,
      testNameAsId,
      TaefBinaryTest.calcLabel(testName),
      file,
      line,
      TaefBinaryTest.isSkipped(testName, suiteName),
      undefined,
      AbstractTest.calcDescription(undefined, typeParam, valueParam, undefined),
      [],
      SharedTestTags.taef,
    );
  }

  update2(
    testName: string,
    suiteName: string,
    file: string | undefined,
    line: string | undefined,
    typeParam: string | undefined,
    valueParam: string | undefined,
  ): void {
    this.update(
      TaefBinaryTest.calcLabel(testName),
      file,
      line,
      TaefBinaryTest.isSkipped(testName, suiteName),
      AbstractTest.calcDescription(undefined, typeParam, valueParam, undefined),
      [],
    );
  }

  private static calcLabel(testName: string): string {
    return testName.startsWith('DISABLED_') ? testName.substr(9) : testName;
  }

  private static isSkipped(testName: string, suiteName: string): boolean {
    return suiteName.startsWith('DISABLED_') || testName.startsWith('DISABLED_');
  }
}

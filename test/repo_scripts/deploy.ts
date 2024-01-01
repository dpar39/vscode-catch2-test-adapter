import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as bent from 'bent';
import { promisify } from 'util';
import * as vsce from '@vscode/vsce';

///

const githubOwnerId = 'dpar39';
const githubRepoId = 'vscode-catch2-test-adapter';
const githubRepoFullId = githubOwnerId + '/' + githubRepoId;
const vscodeExtensionId = githubOwnerId + '-' + githubRepoId;

///

interface Info {
  version: string;
  vver: string;
  major: string;
  minor: string;
  patch: string;
  label: string;
  date: string;
  full: string;
  releaseContent: string;
  mentionedIssues: string[];
}

async function spawn(command: string, ...args: (string | { arg: string; mask?: string })[]): Promise<string> {
  console.log(
    '$ ' + command + ' ' + args.map(a => (typeof a === 'string' ? `"${a}"` : a.mask ?? '<masked>')).join(' '),
  );
  const result = await new Promise<string>((resolve, reject) => {
    const c = cp.spawn(
      command,
      args.map(a => (typeof a === 'string' ? a : a.arg)),
      { stdio: 'inherit' },
    );
    let output = '';
    c.stdout?.on('data', chunk => {
      output += chunk.toString();
    });
    c.on('exit', (code: number) => {
      code == 0 ? resolve(output) : reject(new Error('Process exited with: ' + code));
    });
  });

  console.log(result);
  return result;
}

// eslint-disable-next-line
type JsonResp = { [key: string]: any };

///

async function updateChangelog(): Promise<Info | undefined> {
  console.log('Parsing CHANGELOG.md');

  const changelogBuffer = await promisify(fs.readFile)('CHANGELOG.md');

  const changelog = changelogBuffer.toString();
  // example:'## [0.1.0-beta] - 2018-04-12'
  const re = new RegExp(/## \[(([0-9]+)\.([0-9]+)\.([0-9]+)(?:|(?:-([^\]]+))))\](?: - (.+))?/);

  const match = changelog.match(re);
  if (match === null) {
    throw Error("Release error: Couldn't find version entry");
  }

  assert.strictEqual(match.length, 7);

  if (match[6] != undefined) {
    // we dont want to release it now
    console.log('CHANGELOG.md doesn\'t contain unreleased version entry (ex.: "## [1.2.3]" (without date)).');
    console.log('(Last released version: ' + match[0] + ')');
    return undefined;
  }

  let releaseContent = changelog.substr(match.index! + match[0].length).trimLeft();
  const mentionedIssues: string[] = [];
  {
    const nextM = releaseContent.match(re);
    if (nextM) releaseContent = releaseContent.substring(0, nextM.index!).trimRight();

    const issueRe = new RegExp(`https://github\\.com/${githubRepoFullId}/issues/(\\d+)`, 'g');
    mentionedIssues.push(...[...releaseContent.matchAll(issueRe)].map(x => x[1]));
  }

  const now = new Date();
  const month = now.getUTCMonth() + 1 < 10 ? '0' + (now.getUTCMonth() + 1) : now.getUTCMonth() + 1;
  const day = now.getUTCDate() < 10 ? '0' + now.getUTCDate() : now.getUTCDate();
  const date = now.getUTCFullYear() + '-' + month + '-' + day;

  const changelogWithReleaseDate =
    changelog.substr(0, match.index! + match[0].length) +
    ' - ' +
    date +
    changelog.substr(match.index! + match[0].length);

  console.log('Updating CHANGELOG.md');

  await promisify(fs.writeFile)('CHANGELOG.md', changelogWithReleaseDate);
  return {
    version: match[1],
    vver: 'v' + match[1],
    major: match[2],
    minor: match[3],
    patch: match[4],
    label: match[5],
    date: date,
    full: match[0].substr(3).trim() + ' - ' + date,
    releaseContent,
    mentionedIssues,
  };
}

async function updatePackageJson(info: Info): Promise<void> {
  console.log('Parsing package.json');

  const packageJsonBuffer = await promisify(fs.readFile)('package.json');

  const packageJson = packageJsonBuffer.toString();
  // example:'"version": "1.2.3"'
  const re = new RegExp(/(['"]version['"]\s*:\s*['"])([^'"]*)(['"])/);

  const match: RegExpMatchArray | null = packageJson.match(re);
  assert.notStrictEqual(match, null);
  if (match === null) throw Error("Release error: Couldn't find version entry.");

  assert.strictEqual(match.length, 4);
  assert.notStrictEqual(match[1], undefined);
  assert.notStrictEqual(match[2], undefined);
  assert.notStrictEqual(match[3], undefined);

  const packageJsonWithVer =
    packageJson.substr(0, match.index! + match[1].length) +
    info.version +
    packageJson.substr(match.index! + match[1].length + match[2].length);

  console.log('Updating package.json');

  await promisify(fs.writeFile)('package.json', packageJsonWithVer);
}

async function gitCommitAndTag(info: Info): Promise<void> {
  console.log('Creating commit and tag');

  await spawn('git', 'config', '--local', 'user.name', 'deploy.js');

  const deployerMail = process.env['DEPLOYER_MAIL'] || 'deployer@deployer.de';
  await spawn('git', 'config', '--local', 'user.email', deployerMail);

  await spawn('git', 'status');
  await spawn('git', 'add', '--', 'CHANGELOG.md', 'package.json', 'package-lock.json');
  await spawn('git', 'status');
  await spawn('git', 'commit', '-m', '[Updated] Date in CHANGELOG.md: ' + info.full);
  await spawn('git', 'tag', '-a', info.vver, '-m', 'Version ' + info.vver);
}

async function gitPushBranch(): Promise<void> {
  console.log('Pushing current branch to origin');

  assert.ok(process.env['GITHUBM_API_KEY'] != undefined);

  await spawn('git', 'push', {
    mask: '<http_repo>',
    arg:
      'https://' + githubOwnerId + ':' + process.env['GITHUBM_API_KEY']! + '@github.com/' + githubRepoFullId + '.git',
  });
}

async function gitPushTag(info: Info): Promise<void> {
  console.log('Pushing tag to origin');

  assert.ok(process.env['GITHUBM_API_KEY'] != undefined);

  await spawn(
    'git',
    'push',
    {
      mask: '<http_repo>',
      arg:
        'https://' + githubOwnerId + ':' + process.env['GITHUBM_API_KEY']! + '@github.com/' + githubRepoFullId + '.git',
    },
    `refs/tags/${info.vver}:refs/tags/${info.vver}`,
  );
}

async function gitDeleteTag(info: Info): Promise<void> {
  console.log('Pushing delete tag from origin');

  assert.ok(process.env['GITHUBM_API_KEY'] != undefined);

  await spawn(
    'git',
    'push',
    '--force',
    {
      mask: '<http_repo>',
      arg:
        'https://' + githubOwnerId + ':' + process.env['GITHUBM_API_KEY']! + '@github.com/' + githubRepoFullId + '.git',
    },
    `:refs/tags/${info.vver}`,
  );
}

async function createPackage(info: Info): Promise<string> {
  console.log('Creating vsce package');

  const packagePath = './out/' + vscodeExtensionId + '-' + info.version + '.vsix';

  await vsce.createVSIX({ cwd: '.', packagePath });

  return packagePath;
}

async function publishPackage(packagePath: string): Promise<void> {
  console.log('Publishing vsce package');
  assert.ok(process.env['VSCE_PAT'] != undefined);
  assert.ok(packagePath);

  await vsce.publishVSIX(packagePath, { pat: process.env['VSCE_PAT']! });
}

async function closeMentionedIssues(info: Info): Promise<void> {
  console.log('Closing mentioned issues');
  const issues = new Set(info.mentionedIssues);
  if (issues.size === 0) {
    return;
  }

  // cannot be used for push because it has just a collaboration role
  assert.ok(typeof process.env['GITHUBM_API_KEY'] === 'string');
  const apiKey = process.env['GITHUBM_API_KEY']!;
  const keyBase64 = Buffer.from(`${githubOwnerId}:${apiKey}`, 'utf-8').toString('base64');
  const headerBase = {
    'User-Agent': `${githubOwnerId}-deploy.js`,
    Authorization: `Basic ${keyBase64}`,
    Accept: 'application/vnd.github.v3+json',
  };

  for (const issueId of issues) {
    //https://docs.github.com/en/rest/reference/issues#edit-an-issue

    await bent(
      `https://api.github.com`,
      'json',
      'POST',
      201,
    )(
      `/repos/${githubRepoFullId}/issues/${issueId}/comments`,
      {
        body: [
          '<details>',
          `<summary>Fixed in <b>${info.vver}</b>.</summary>`,
          '',
          'This issue was mentioned in [CHANGELOG.md](./CHANGELOG.md) under a released entry so it is assumed to be fixed.',
          'User verifications are always welcome.',
          '</details>',
        ].join('\n'),
      },
      headerBase,
    );

    await bent(`https://api.github.com`, 'json', 'PATCH')(
      `/repos/${githubRepoFullId}/issues/${issueId}`,
      {
        state: 'closed',
      },
      headerBase,
    );
  }
}

async function createGithubRelease(info: Info, packagePath: string): Promise<void> {
  console.log('Publishing to github releases');
  assert.ok(typeof process.env['GITHUBM_API_KEY'] === 'string');
  const apiKey = process.env['GITHUBM_API_KEY']!;
  const keyBase64 = Buffer.from(`${githubOwnerId}:${apiKey}`, 'utf-8').toString('base64');
  const headerBase = {
    'User-Agent': `${githubOwnerId}-deploy.js`,
    Authorization: `Basic ${keyBase64}`,
  };

  const response: JsonResp = await bent(`https://api.github.com`, 'json', 'GET')(
    `/repos/${githubRepoFullId}/releases/latest`,
    undefined,
    headerBase,
  );

  assert.notStrictEqual(response.tag_name, info.vver);

  const createReleaseResponse: JsonResp = await bent(
    `https://api.github.com`,
    'json',
    'POST',
    201,
  )(
    `/repos/${githubRepoFullId}/releases`,
    {
      tag_name: info.vver, // eslint-disable-line
      name: info.full,
      body: 'See [CHANGELOG.md](CHANGELOG.md) for details.',
    },
    headerBase,
  );

  const stats = fs.statSync(packagePath);
  assert.ok(stats.isFile(), packagePath);

  console.log('Uploading artifact to github releases');

  const stream = fs.createReadStream(packagePath);

  await bent('json', 'POST', 201)(
    createReleaseResponse.upload_url.replace('{?name,label}', `?name=${vscodeExtensionId}-${info.version}.vsix`),
    stream,
    Object.assign(
      {
        'Content-Type': 'application/zip',
        'Content-Length': stats.size,
      },
      headerBase,
    ),
  );
}

///

async function main(argv: string[]): Promise<void> {
  console.log('deploying; args: ' + argv.join(' '));

  // pre-checks
  assert.strictEqual(path.basename(process.cwd()), githubRepoId);
  assert.ok(process.env['VSCE_PAT']);
  assert.ok(process.env['GITHUBM_API_KEY']);

  const info = await updateChangelog();

  if (info !== undefined) {
    await updatePackageJson(info);

    await gitCommitAndTag(info);

    const packagePath = await createPackage(info);

    await gitPushTag(info);

    try {
      await publishPackage(packagePath);
    } catch (e) {
      await gitDeleteTag(info);
      throw e;
    }

    await gitPushBranch();

    await createGithubRelease(info, packagePath);

    await closeMentionedIssues(info);

    console.log('Deployment has finished.');
  } else {
    console.log('Nothing new in CHANGELOG.md; No deployment has happened.');
  }
}

///

main(process.argv.slice(2)).then(
  () => {
    process.exit(0);
  },
  (err: Error) => {
    console.error('Unhandled error during deployment!', err);
    process.exit(-1);
  },
);

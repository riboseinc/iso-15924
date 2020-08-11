import path from 'path';
import axios from 'axios';
import parse from 'csv-parse';
import unzipper from 'unzipper';
import { exec } from 'child_process';
import fs from 'fs';
import readline from 'readline';


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});


interface Item {
  "Code": string
  "N°": number
  "English Name": string
  "Nom français": string
  "PVA": string
  "Unicode Version": string
  "Date": Date
}


interface ItemIndex {
  [code: string]: Item
}


const packageName = '@riboseinc/iso-15924';


const parser = parse({
  skipEmptyLines: true,
  delimiter: ';',
  comment: "#",
  columns: ['Code', 'N°', 'English Name', 'Nom français', 'PVA', 'Unicode Version', 'Date'],
});


async function getLatestPublishedVersion(): Promise<null | [ string, string, string ]> {
  return new Promise((resolve, reject) => {
    exec(`npm show ${packageName} version`, function (_, stdout, __) {
      const result = (stdout || '').trim();

      if (result === '') {
        console.warn("Empty NPM response for package version request");
        resolve(null);
      } else {
        const parts = result.split('.');
        if (parts.length === 3) {
          const [ major, timestamp, patch ] = stdout.split('.').map(i => i.trim());
          resolve([ major, timestamp, patch ]);
        } else {
          console.error("Invalid version obtained from NPM", stdout);
          reject(new Error("Invalid version obtained from NPM"));
        }
      }
    });
  });
}


async function requestInput(msg: string): Promise<string> {
  return new Promise((resolve, _) => {
    rl.question(msg, function (result) {
      resolve(result || '');
    });
  });
}


async function main() {
  console.info("Fetching latest published version…");

  let major: string;
  let minor: string;
  var patch: string;

  const latestPublishedVersion = await getLatestPublishedVersion();

  console.info("Fetching latest published version: got", latestPublishedVersion);

  console.info("Fetching dataset…")

  const { items, version } = await fetchData();

  if (latestPublishedVersion !== null) {
    major = latestPublishedVersion[0];
    minor = latestPublishedVersion[1];
    patch = latestPublishedVersion[2];

    if (version === minor) {
      const incrementPatch = (await requestInput("Minor component of latest published version matches current dataset timestamp; increment patch version or abort? Y to increment: ")) === 'Y';

      if (!incrementPatch) {
        console.info("Not confirmed — exiting");
        throw new Error("Aborted by user");
      }

      patch = `${parseInt(patch, 10) + 1}`;
    }

  } else {
    const confirmInitialVersion = (await requestInput("Could not fetch latest published version, respond with Y to set major and patch components to 1 and 0: ")) === 'Y';

    if (!confirmInitialVersion) {
      console.info("Not confirmed — exiting");
      throw new Error("Aborted by user");
    }

    major = '1';
    minor = version;
    patch = '0';
  }

  const doIncrementMajor = (await requestInput("Would you like to increment major version? Y for yes: ")) === 'Y';

  if (doIncrementMajor) {
    major = `${parseInt(major, 10) + 1}`;
  }

  const index: ItemIndex = createIndex(items);
  const packageRaw = fs.readFileSync('package-dist.json', { encoding: 'utf-8' });
  const packageData = JSON.parse(packageRaw);

  packageData.version = `${major}.${minor}.${patch}`;

  const confirmVersion = (await requestInput(`Does this version look OK? ${packageData.version}: (Y if OK) `)) === 'Y';
  if (!confirmVersion) {
    console.info("Aborted! Version doesn’t look good");
    throw new Error("Aborted by user");
  }

  fs.writeFileSync('dist/package.json', JSON.stringify(packageData, undefined, 2), { encoding: 'utf-8' });
  fs.writeFileSync('dist/index.json', JSON.stringify(items), { encoding: 'utf-8' });
  fs.writeFileSync('dist/index-by-code.json', JSON.stringify(index), { encoding: 'utf-8' });
}


function createIndex(items: Item[]): ItemIndex {
  const index: ItemIndex = items.
  map(i => ({ [i.Code]: i })).
  reduce((prevVal, currVal) => ({ ...prevVal, ...currVal }));
  return index;
}


async function fetchData(): Promise<{ items: Item[], version: string }> {
  const resp = await axios({
    method: 'get',
    url: 'https://www.unicode.org/iso15924/iso15924.txt.zip',
    responseType: 'stream',
  });

  return new Promise((resolve, _) => {
    const items: Item[] = [];

    resp.data.
    pipe(unzipper.Parse()).
    on('entry', (e) => {
      const filename = path.basename(e.path, '.txt');

      if (filename.indexOf('iso15924-utf8-') === 0) {
        const version = filename.split('-')[2];
        console.info("Got dataset version", version);

        e.pipe(parser).
        on('data', (i: Item) => items.push(i)).
        on('end', () => resolve({ items, version }));

      } else {
        console.warn("Unexpected file in archive", filename)
        e.autodrain();
      }
    });
  });
}


main().finally(() => {
  exit(0);
});


function exit(code: number) {
  rl.close();
  process.exit(code);
}

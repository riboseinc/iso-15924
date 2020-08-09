import path from 'path';
import axios from 'axios';
import parse from 'csv-parse';
import unzipper from 'unzipper';
import fs from 'fs';


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


const parser = parse({
  skipEmptyLines: true,
  delimiter: ';',
  comment: "#",
  columns: ['Code', 'N°', 'English Name', 'Nom français', 'PVA', 'Unicode Version', 'Date'],
});


async function main() {
  const { items, version } = await fetchData();
  const index: ItemIndex = createIndex(items);
  const packageRaw = fs.readFileSync('package-dist.json', { encoding: 'utf-8' });
  const packageData = JSON.parse(packageRaw);
  packageData.version = `1.${version}.0`;

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
        console.info("Processing version", version);

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


main();

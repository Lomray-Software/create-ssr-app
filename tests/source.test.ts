import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadArchive, loadSource } from '../src/source.js';
import { systemTar, temporaryDirectory, writeFixture } from './helpers.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GitHub downloads', () => {
  it('uses the branch endpoint and returns the downloaded bytes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('archive'));

    vi.stubGlobal('fetch', fetchMock);
    expect(await downloadArchive('example/minimal', false)).toEqual(Buffer.from('archive'));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://codeload.github.com/Lomray-Software/vite-template/tar.gz/refs/heads/example/minimal',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['v1.2.3', 'abcd1234', 'refs/tags/v1.0.0'])(
    'falls back for a non-branch --ref %s',
    async (ref) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response('archive'));

      vi.stubGlobal('fetch', fetchMock);
      expect(await downloadArchive(ref, true)).toEqual(Buffer.from('archive'));
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        `https://codeload.github.com/Lomray-Software/vite-template/tar.gz/${ref}`,
      );
    },
  );

  it('does not fall back for server errors or a mapped template branch', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadArchive('ref', true)).rejects.toThrow('HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(downloadArchive('prod', false)).rejects.toThrow('HTTP 404');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports network failures with their cause', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(
          new TypeError('fetch failed', { cause: new Error('connection refused') }),
        ),
    );
    await expect(downloadArchive('prod', false)).rejects.toThrow(
      'network failure (fetch failed: connection refused)',
    );
  });
});

describe('offline sources', () => {
  it.each(['directory', 'archive'])('uses a local %s without fetching', async (kind) => {
    const parent = await temporaryDirectory();

    temporary.push(parent);
    const source = join(parent, 'template');

    await writeFixture(source);
    const archivePath = join(parent, 'offline.tar.gz');

    await writeFile(archivePath, gzipSync(await systemTar(parent, 'pax')));
    const fetchMock = vi.fn<typeof fetch>();

    vi.stubGlobal('fetch', fetchMock);
    const destination = join(parent, 'output');

    await loadSource(destination, 'unused-ref', true, kind === 'directory' ? source : archivePath);
    expect(await readFile(join(destination, 'package.json'))).toEqual(
      await readFile(join(source, 'package.json')),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports missing sources and invalid gzip archives', async () => {
    const parent = await temporaryDirectory();

    temporary.push(parent);
    await mkdir(join(parent, 'output'));
    await expect(
      loadSource(join(parent, 'output'), 'prod', false, join(parent, 'missing')),
    ).rejects.toThrow('Offline source');
    await writeFile(join(parent, 'bad.tar.gz'), 'not gzip');
    await expect(
      loadSource(join(parent, 'output'), 'prod', false, join(parent, 'bad.tar.gz')),
    ).rejects.toThrow('Unable to decompress');
  });
});

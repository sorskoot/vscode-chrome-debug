/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';

import {BasePathTransformer} from './basePathTransformer';

import * as logger from '../logger';
import * as utils from '../utils';
import * as errors from '../errors';
import {ISetBreakpointsArgs, IAttachRequestArgs, IStackTraceResponseBody} from '../debugAdapterInterfaces';

/**
 * Converts a local path from Code to a path on the target.
 */
export class RemotePathTransformer extends BasePathTransformer {
    private _localRoot: string;
    private _remoteRoot: string;

    public attach(args: IAttachRequestArgs): Promise<void> {
        // Maybe validate that it's absolute, for either windows or unix
        this._remoteRoot = args.remoteRoot;

        // Validate that localRoot is absolute and exists
        let localRootP = Promise.resolve<void>();
        if (args.localRoot) {
            const localRoot = args.localRoot;
            if (!path.isAbsolute(localRoot)) {
                return Promise.reject(errors.attributePathRelative('localRoot', localRoot));
            }

            localRootP = new Promise<void>((resolve, reject) => {
                fs.exists(localRoot, exists => {
                    if (!exists) {
                        reject(errors.attributePathNotExist('localRoot', localRoot));
                    }

                    this._localRoot = localRoot;
                    resolve();
                });
            });
        }

        return localRootP;
    }

    public setBreakpoints(args: ISetBreakpointsArgs): Promise<void> {
        if (!args.source.path) {
            return Promise.resolve<void>();
        }

        args.source.path = this.localToRemote(args.source.path);
        return super.setBreakpoints(args);
    }

    public scriptParsed(scriptPath: string): string {
        scriptPath = this.remoteToLocal(scriptPath);
        return super.scriptParsed(scriptPath);
    }

    public stackTraceResponse(response: IStackTraceResponseBody): void {
        response.stackFrames.forEach(frame => {
            const remotePath = frame.source.path;
            if (remotePath) {
                frame.source.path = this.remoteToLocal(remotePath);
            }
        });

        return super.stackTraceResponse(response);
    }

    private shouldMapPaths(remotePath: string): boolean {
        // Map paths only if localRoot/remoteRoot are set, and the remote path is absolute on some system
        return !!this._localRoot && !!this._remoteRoot && (path.posix.isAbsolute(remotePath) || path.win32.isAbsolute(remotePath));
    }

    private remoteToLocal(remotePath: string): string {
        if (!this.shouldMapPaths(remotePath)) return remotePath;

        const relPath = relative(this._remoteRoot, remotePath);
        let localPath = path.join(this._localRoot, relPath);

        localPath = utils.fixDriveLetterAndSlashes(localPath);
        logger.log(`Mapped remoteToLocal: ${remotePath} -> ${localPath}`);
        return localPath;
    }

    private localToRemote(localPath: string): string {
        if (!this.shouldMapPaths(localPath)) return localPath;

        const relPath = relative(this._localRoot, localPath);
        let remotePath = path.join(this._remoteRoot, relPath);

        remotePath = utils.fixDriveLetterAndSlashes(remotePath, /*uppercaseDriveLetter=*/true);
        logger.log(`Mapped localToRemote: ${localPath} -> ${remotePath}`);
        return remotePath;
    }
}

/**
 * Cross-platform path.relative
 */
function relative(a: string, b: string): string {
    return a.match(/^[A-Za-z]:/) ?
        path.win32.relative(a, b) :
        path.posix.relative(a, b);
}
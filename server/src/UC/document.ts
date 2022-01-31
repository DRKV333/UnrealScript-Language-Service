import { CommonTokenStream } from 'antlr4ts';
import { PredictionMode } from 'antlr4ts/atn/PredictionMode';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { DocumentUri } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import { UCLexer } from './antlr/generated/UCLexer';
import { ProgramContext, UCParser } from './antlr/generated/UCParser';
import { UCPreprocessorParser } from './antlr/generated/UCPreprocessorParser';
import { IDiagnosticNode } from './diagnostics/diagnostic';
import { DocumentASTWalker } from './documentASTWalker';
import { applyMacroSymbols, config, IndexedReferencesMap, UCGeneration } from './indexer';
import { Name, toName } from './name';
import { UCErrorListener } from './Parser/ErrorListener';
import { ERROR_STRATEGY } from './Parser/ErrorStrategy';
import { UCInputStream } from './Parser/InputStream';
import { UCTokenStream } from './Parser/TokenStream';
import {
    ISymbol, removeHashedSymbol, SymbolReference, SymbolsTable, UCClassSymbol, UCPackage,
    UCStructSymbol, UCSymbol
} from './Symbols';
import { SymbolWalker } from './symbolWalker';

function removeChildren(scope: UCStructSymbol) {
    for (let child = scope.children; child; child = child.next) {
        if (child instanceof UCStructSymbol) {
            removeChildren(child);
        }
        if (child.getKind() === SymbolKind.Struct
            || child.getKind() === SymbolKind.Enum) {
            removeHashedSymbol(child);
        }
    }
}

export type DocumentParseData = {
    context?: ProgramContext;
    parser: UCParser;
};

export class UCDocument {
    /** Parsed file name filtered of path and extension. */
    public readonly fileName: string;
    public readonly name: Name;
    public readonly uri: DocumentUri;

    // TODO: Displace this with a DiagnosticCollection visitor.
    public nodes: IDiagnosticNode[] = [];

    /** The class or interface header symbol */
    public class?: UCClassSymbol;
    public hasBeenIndexed = false;

    private readonly indexReferencesMade = new Map<number, Set<SymbolReference>>();

    // List of symbols, including macro declarations.
    private scope = new SymbolsTable<UCSymbol>();

    constructor(readonly filePath: string, public readonly classPackage: UCPackage) {
        this.fileName = path.basename(filePath, '.uc');
        this.name = toName(this.fileName);
        this.uri = URI.file(filePath).toString();
    }

    public getSymbols() {
        return Array.from(this.scope.getAll());
    }

    public addSymbol(symbol: UCSymbol) {
        this.scope.addSymbol(symbol);
    }

    public build(text: string = this.readText()): DocumentParseData {
        console.log('building document ' + this.fileName);

        const inputStream = UCInputStream.fromString(text);
        const lexer = new UCLexer(inputStream);
        const errorListener = new UCErrorListener();
        lexer.removeErrorListeners(); lexer.addErrorListener(errorListener);
        const walker = new DocumentASTWalker(this, this.scope);
        const tokens = new UCTokenStream(lexer);

        if (config.generation === UCGeneration.UC3) {
            const startPreprocressing = performance.now();
            const macroParser = createPreprocessor(this, lexer);
            lexer.reset();
            if (macroParser) {
                try {
                    const macroTree = preprocessDocument(this, macroParser, walker);
                    if (macroTree) {
                        tokens.initMacroTree(macroTree, errorListener);
                    }
                } catch (err) {
                    console.error(err);
                } finally {
                    console.info(this.fileName + ': preprocessing time ' + (performance.now() - startPreprocressing));
                }
            }
        }

        const startWalking = performance.now();
        tokens.fill();

        let context: ProgramContext | undefined;
        const parser = new UCParser(tokens);
        try {
            parser.interpreter.setPredictionMode(PredictionMode.SLL);
            parser.errorHandler = ERROR_STRATEGY;
            parser.removeErrorListeners(); parser.addErrorListener(errorListener);
            context = parser.program();
        } catch (err) {
            console.debug('PredictionMode SLL has failed, rolling back to LL.');
            try {
                errorListener.nodes = [];
                parser.reset();
                parser.interpreter.setPredictionMode(PredictionMode.LL);
                parser.errorHandler = ERROR_STRATEGY;
                parser.removeErrorListeners(); parser.addErrorListener(errorListener);
                context = parser.program();
            } catch (err) {
                console.error(
                    `An error was thrown while parsing document: "${this.uri}"`,
                    err
                );
            }
        } finally {
            try {
                parser.reset(true);
                if (context) {
                    walker.tokenStream = tokens;
                    walker.visit(context);
                }
            } catch (err) {
                console.error(
                    `An error was thrown while transforming document: "${this.uri}"`,
                    err
                );
            }
            console.info(this.fileName + ': transforming time ' + (performance.now() - startWalking));
        }
        tokens.release(tokens.mark());
        this.nodes = this.nodes.concat(errorListener.nodes);
        return { context, parser };
    }

    public readText(): string {
        const filePath = URI.parse(this.uri).fsPath;
        const text = fs.readFileSync(filePath).toString();
        return text;
    }

    public invalidate(cleanup = true) {
        if (cleanup) {
            // Remove hashed objects from the global objects table.
            // This however does not invoke any invalidation calls to dependencies.
            // TODO: Merge this with scope.clear();
            if (this.class) {
                removeChildren(this.class);
                removeHashedSymbol(this.class);
            }
        }
        this.class = undefined;
        this.scope.clear();
        this.nodes = []; // clear
        this.hasBeenIndexed = false;

        // Clear all the indexed references that we have made.
        for (const [key, value] of this.indexReferencesMade) {
            const refs = IndexedReferencesMap.get(key);
            if (refs) {
                value.forEach(ref => refs.delete(ref));
            }
        }
        this.indexReferencesMade.clear();
    }

    indexReference(symbol: ISymbol, ref: SymbolReference) {
        const key = symbol.getHash();
        const value = this.indexReferencesMade.get(key);

        const set = value ?? new Set<SymbolReference>();
        set.add(ref);

        if (!value) {
            this.indexReferencesMade.set(key, set);
        }

        // TODO: Refactor this, we are pretty much duplicating this function's job.
        const gRefs = IndexedReferencesMap.get(key) ?? new Set<SymbolReference>();
        gRefs.add(ref);
        IndexedReferencesMap.set(key, gRefs);
    }

    accept<Result>(visitor: SymbolWalker<Result>): Result | void {
        return visitor.visitDocument(this);
    }
}

export function createPreprocessor(document: UCDocument, lexer: UCLexer) {
    const macroStream = new CommonTokenStream(lexer, UCLexer.MACRO);
    macroStream.fill();

    if (macroStream.getNumberOfOnChannelTokens() <= 1) {
        return undefined;
    }

    const macroParser = new UCPreprocessorParser(macroStream);
    macroParser.filePath = document.uri;
    return macroParser;
}

export function preprocessDocument(document: UCDocument, macroParser: UCPreprocessorParser, walker?: DocumentASTWalker) {
    if (document.fileName.toLowerCase() === 'globals.uci') {
        UCPreprocessorParser.globalSymbols = macroParser.currentSymbols;
        applyMacroSymbols(config.macroSymbols);
    }

    const classNameMacro = { text: document.fileName.substring(0, document.fileName.indexOf('.uc')) };
    macroParser.currentSymbols.set("classname", classNameMacro);

    const packageNameMacro = { text: document.classPackage.getName().text };
    macroParser.currentSymbols.set("packagename", packageNameMacro);

    if (walker) {
        const errorListener = new UCErrorListener();
        macroParser.removeErrorListeners(); macroParser.addErrorListener(errorListener);
    }
    const macroCtx = macroParser.macroProgram();
    if (walker) {
        walker.visit(macroCtx);
    }
    return macroCtx;
}
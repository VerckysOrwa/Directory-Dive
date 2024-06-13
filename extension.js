const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const prettier = require('prettier');

function activate(context) {
    console.log('Directory Dive extension is now active!');

    // Create a status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'extension.showBookmarks';
    statusBarItem.text = '$(bookmark) Show Bookmarks';
    statusBarItem.tooltip = 'Click to show all bookmarks';
    context.subscriptions.push(statusBarItem);
    updateStatusBar(context, statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.directoryDive', () => searchAndOpenFile(context)),
        vscode.commands.registerCommand('extension.recentFiles', () => showRecentFiles(context)),
        vscode.commands.registerCommand('extension.searchHistory', () => showSearchHistory(context)),
        vscode.commands.registerCommand('extension.addBookmark', () => addBookmark(context, statusBarItem)),
        vscode.commands.registerCommand('extension.showBookmarks', () => showBookmarks(context, statusBarItem)),
        vscode.commands.registerCommand('extension.removeBookmark', () => removeBookmark(context, statusBarItem))
    );

    console.log('All commands registered');
}

async function searchAndOpenFile(context) {
    try {
        const query = await vscode.window.showInputBox({ prompt: 'Enter the file path or part of it' });
        if (!query) {
            return;
        }

        addSearchToHistory(query, context);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showInformationMessage('No workspace is open.');
            return;
        }

        const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
        const matchedFiles = files.filter(file => file.fsPath.includes(query));

        if (matchedFiles.length === 0) {
            vscode.window.showInformationMessage('No files matched your query.');
        } else {
            const fileInfo = await getFileInfo(matchedFiles);
            const selectedFile = await vscode.window.showQuickPick(
                fileInfo.map(info => `${info.path} (${info.size} bytes)`),
                { placeHolder: 'Multiple files found. Select one to preview or open.', canPickMany: false }
            );

            if (selectedFile) {
                const selectedFilePath = selectedFile.split(' (')[0]; // Extract the file path from the quick pick item
                const preview = await vscode.window.showQuickPick(['Preview', 'Open'], { placeHolder: 'Do you want to preview or open the file?' });

                if (preview === 'Preview') {
                    await previewFile(selectedFilePath);
                } else if (preview === 'Open') {
                    await openFile(selectedFilePath, context);
                }
            }
        }
    } catch (error) {
        console.error('Error during searchAndOpenFile:', error);
    }
}

async function getFileInfo(files) {
    const fileInfoPromises = files.map(async file => {
        const stats = await fs.promises.stat(file.fsPath);
        return {
            path: file.fsPath,
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString()
        };
    });

    return Promise.all(fileInfoPromises);
}

async function previewFile(filePath) {
    try {
        const previewLength = await vscode.window.showInputBox({ prompt: 'Enter the number of characters to preview', value: '500' });
        const length = parseInt(previewLength, 10);
        if (isNaN(length) || length <= 0) {
            vscode.window.showErrorMessage('Invalid preview length.');
            return;
        }

        const document = await vscode.workspace.openTextDocument(filePath);
        const content = document.getText();
        const previewContent = content.substring(0, length) + (content.length > length ? '...' : ''); // Custom preview length

        const stats = await fs.promises.stat(filePath);
        const metadata = `Size: ${stats.size} bytes\nLast Modified: ${stats.mtime.toISOString()}\nCreated: ${stats.birthtime.toISOString()}`;

        const ext = path.extname(filePath).slice(1);
        let parser;
        if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
            parser = 'babel';
        } else if (['json'].includes(ext)) {
            parser = 'json';
        } else if (['html', 'htm'].includes(ext)) {
            parser = 'html';
        } else if (['css', 'scss'].includes(ext)) {
            parser = 'css';
        } else {
            parser = 'babel'; // Default parser
        }

        let formattedContent;
        try {
            formattedContent = prettier.format(previewContent, { parser: parser });
        } catch (formattingError) {
            console.error(`Error formatting content with Prettier for file: ${filePath}`, formattingError);
            formattedContent = previewContent; // Fallback to raw preview content
        }

        vscode.window.showInformationMessage(`Preview of ${filePath}:\n${formattedContent}\n\nMetadata:\n${metadata}`);
    } catch (error) {
        console.error(`Error previewing file: ${filePath}`, error);
        vscode.window.showErrorMessage(`Error previewing file: ${filePath}`);
    }
}

async function openFile(filePath, context) {
    try {
        const document = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(document);
        addToRecentFiles(filePath, context);
    } catch (error) {
        console.error('Error during openFile:', error);
    }
}

function addToRecentFiles(filePath, context) {
    let recentFiles = context.globalState.get('recentFiles', []);
    recentFiles = [filePath, ...recentFiles.filter(file => file !== filePath)].slice(0, 10); // Keep max 10 recent files
    context.globalState.update('recentFiles', recentFiles);
}

function showRecentFiles(context) {
    let recentFiles = context.globalState.get('recentFiles', []);
    if (recentFiles.length === 0) {
        vscode.window.showInformationMessage('No recent files.');
        return;
    }

    vscode.window.showQuickPick(recentFiles, { placeHolder: 'Select a recent file to open' }).then(selectedFile => {
        if (selectedFile) {
            openFile(selectedFile, context);
        }
    });
}

function addSearchToHistory(query, context) {
    let searchHistory = context.globalState.get('searchHistory', []);
    searchHistory = [query, ...searchHistory.filter(item => item !== query)].slice(0, 10); // Keep max 10 searches
    context.globalState.update('searchHistory', searchHistory);
}

function showSearchHistory(context) {
    let searchHistory = context.globalState.get('searchHistory', []);
    if (searchHistory.length === 0) {
        vscode.window.showInformationMessage('No search history.');
        return;
    }

    vscode.window.showQuickPick(searchHistory, { placeHolder: 'Select a previous search to re-run' }).then(selectedQuery => {
        if (selectedQuery) {
            searchAndOpenFile(selectedQuery, context);
        }
    });
}

function addBookmark(context, statusBarItem) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const filePath = activeEditor.document.fileName;
        let bookmarks = context.globalState.get('bookmarks', []);
        bookmarks = [filePath, ...bookmarks.filter(file => file !== filePath)].slice(0, 10); // Keep max 10 bookmarks
        context.globalState.update('bookmarks', bookmarks);
        vscode.window.showInformationMessage(`Bookmarked: ${filePath}`);
        updateStatusBar(context, statusBarItem);
    } else {
        vscode.window.showInformationMessage('No active editor.');
    }
}

function showBookmarks(context, statusBarItem) {
    let bookmarks = context.globalState.get('bookmarks', []);
    if (bookmarks.length === 0) {
        vscode.window.showInformationMessage('No bookmarks.');
        return;
    }

    vscode.window.showQuickPick(
        bookmarks.map((bookmark) => ({ label: bookmark, description: 'Open or Remove' })),
        {
            placeHolder: 'Select a bookmarked file to open or remove',
        }
    ).then(async (selectedBookmark) => {
        if (!selectedBookmark) {
            return;
        }

        const action = await vscode.window.showQuickPick(['Open', 'Remove'], {
            placeHolder: `Do you want to open or remove the bookmark? (${selectedBookmark.label})`,
        });

        if (action === 'Open') {
            openFile(selectedBookmark.label, context);
        } else if (action === 'Remove') {
            removeBookmark(context, selectedBookmark.label, statusBarItem);
        }
    });
}

function removeBookmark(context, filePath, statusBarItem) {
    let bookmarks = context.globalState.get('bookmarks', []);
    bookmarks = bookmarks.filter(file => file !== filePath);
    context.globalState.update('bookmarks', bookmarks);
    vscode.window.showInformationMessage(`Removed bookmark: ${filePath}`);
    updateStatusBar(context, statusBarItem);
}

function updateStatusBar(context, statusBarItem) {
    let bookmarks = context.globalState.get('bookmarks', []);
    if (bookmarks.length > 0) {
        statusBarItem.text = `$(bookmark) ${bookmarks.length} Bookmarks`;
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};

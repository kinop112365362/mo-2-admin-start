const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const { execSync, exec } = require('child_process');
const net = require('net');
const glob = require('glob');
const figlet = require('figlet');
const chalk = require('chalk');
const logSymbols = require('log-symbols');

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => {
        resolve(port);
      });
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        findAvailablePort(startPort + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    });
  });
}

const server = http.createServer();
const wss = new WebSocket.Server({
  server
});

// 读取 mo.config.json
const moConfigPath = path.join(process.cwd(), 'mo.config.json');
let moConfig = {};

try {
  if (fs.existsSync(moConfigPath)) {
    moConfig = JSON.parse(fs.readFileSync(moConfigPath, 'utf8'));
  } else {
    // 如果文件不存在，使用默认模板初始化
    moConfig = {
      templates: {},
      port: 3000,
      isInitialized: true,
      startUrl: 'http://localhost:5173/',
      agentType: '企业内部系统',
      setting: [
        '# 角色设定',
        '你是 Web 开发专家，精通 CSS、JavaScript、React、Tailwind。你擅长选择和使用最佳工具，并尽最大努力避免不必要的重复和复杂性。',
        '# 开发规范'
      ],
      includeList: ['src/**/*.js', 'src/**/*.ts'],
      appId: '',
      organizationId: 1,
      ignoreList: [
        '#summary',
        '.npmrc',
        '.git',
        'node_modules',
        'public',
        'scripts',
        '.eslintrc.cjs',
        'components.json',
        'src/components/ui',
        '.gitignore',
        'package-lock.json',
        'README.md',
        'tsconfig.json',
        'vite.config.ts',
        'yarn.lock',
        'tsconfig.app.json',
        'tsconfig.node.json',
        'postcss.config.js',
        '.DS_Store',
        '.vscode'
      ]
    };
    fs.writeFileSync(moConfigPath, JSON.stringify(moConfig, null, 2));
    console.log(
      chalk.green(
        logSymbols.success,
        'Created mo.config.json with default template'
      )
    );
  }
} catch (error) {
  console.error(
    chalk.red(logSymbols.error, 'Error reading or creating mo.config.json:'),
    error.message
  );
  process.exit(1);
}

let PORT = moConfig.port || 3000;

// 检查 includeList 是否有效
if (
  !moConfig.includeList ||
  !Array.isArray(moConfig.includeList) ||
  moConfig.includeList.length === 0
) {
  console.error(
    chalk.red(
      logSymbols.error,
      'Error: includeList is required and must be a non-empty array'
    )
  );
  process.exit(1);
}

// 显示炫酷的启动标题
console.log(
  chalk.cyan(
    figlet.textSync('Mo-2 Agent', {
      font: 'Standard',
      horizontalLayout: 'default',
      verticalLayout: 'default'
    })
  )
);

console.log(chalk.green(logSymbols.info, 'Starting Mo-2 Agent server...'));

findAvailablePort(PORT)
  .then((availablePort) => {
    PORT = availablePort;
    server.listen(PORT, () => {
      console.log(
        chalk.green(
          logSymbols.success,
          `Mo-2 Agent Server running at http://localhost:${PORT}`
        )
      );
    });
  })
  .catch((err) => {
    console.error(
      chalk.red(logSymbols.error, 'Unable to find available port:')
    );
    console.error(chalk.red(err));
  });

function getDirectoryStructure(rootDir, includeList, ignoreList) {
  let result = [];
  // 使用 glob 匹配文件
  console.log('Include patterns:', includeList);
  const matchedFiles = includeList.flatMap((pattern) => {
    const files = glob.sync(pattern, {
      cwd: rootDir,
      ignore: ignoreList,
      nodir: true
    });
    console.log('Matched files for pattern:', files);
    return files;
  });

  if (matchedFiles.length === 0) {
    console.warn(
      chalk.yellow(logSymbols.warning, 'No files matched the include patterns')
    );
    return result;
  }

  matchedFiles.forEach((file) => {
    const parts = file.split(path.sep);
    let currentLevel = result;

    parts.forEach((part, index) => {
      let existingItem = currentLevel.find((item) => item.name === part);
      let isLastPart;
      if (!existingItem) {
        isLastPart = index === parts.length - 1;
        const newItem = {
          name: part,
          type: isLastPart ? 'file' : 'directory'
        };

        if (isLastPart) {
          newItem.content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        } else {
          newItem.children = [];
        }

        currentLevel.push(newItem);
        existingItem = newItem;
      }

      if (!isLastPart) {
        currentLevel = existingItem.children;
      }
    });
  });

  return result;
}

function gitCommit(summary) {
  try {
    execSync('git add .');
    execSync(`git commit -m "feat(mo-2): ${summary}"`);
    console.log(chalk.green(logSymbols.success, 'Git commit successful'));
    return true;
  } catch (error) {
    console.error(chalk.red(logSymbols.error, 'Git commit failed:'), error);
    return false;
  }
}

function gitRollback() {
  try {
    execSync('git reset --hard HEAD~1');
    console.log(chalk.green(logSymbols.success, 'Git rollback successful'));
    return true;
  } catch (error) {
    console.error(chalk.red(logSymbols.error, 'Git rollback failed:'), error);
    return false;
  }
}

function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(`执行命令失败: ${error.message}`);
        return;
      }
      if (stderr) {
        reject(`命令执行出错: ${stderr}`);
        return;
      }
      resolve(stdout);
    });
  });
}

wss.on('connection', (ws) => {
  const rootDir = process.cwd();

  const isInitialized = moConfig.isInitialized;
  let directoryStructure = [];

  try {
    directoryStructure = getDirectoryStructure(
      rootDir,
      moConfig.includeList,
      moConfig.ignoreList
    );
  } catch (error) {
    console.error(
      chalk.red(logSymbols.error, 'Error getting directory structure:'),
      error.message
    );
    ws.send(
      JSON.stringify({
        success: false,
        message: error.message
      })
    );
    return;
  }

  const serverAddress = `http://localhost:${PORT}`;

  ws.send(
    JSON.stringify({
      isInitialized,
      directoryStructure,
      serverAddress,
      agentType: moConfig.agentType,
      startUrl: moConfig.startUrl,
      success: true,
      setting: moConfig.setting
    })
  );

  let pendingChanges = [];

  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    const {
      action,
      filePath,
      content,
      projectPath,
      templateName,
      appId,
      summary,
      command
    } = data;

    if (action === 'writeFile') {
      const absolutePath = path.join(rootDir, filePath);
      if (!absolutePath.startsWith(rootDir)) {
        ws.send(
          JSON.stringify({
            success: false,
            message: '无法访问项目根目录之外的文件',
            filePath
          })
        );
        return;
      }

      const dirPath = path.dirname(absolutePath);

      try {
        await fs.promises.mkdir(dirPath, { recursive: true });

        // 检查内容是否以反引号开头和结尾，如果是则去掉
        let cleanedContent = content;
        if (content.startsWith('`') && content.endsWith('`')) {
          cleanedContent = content.slice(1, -1);
        }

        await fs.promises.writeFile(absolutePath, cleanedContent);
        const fileContent = await fs.promises.readFile(absolutePath, 'utf8');

        // 更新目录结构
        directoryStructure = getDirectoryStructure(
          rootDir,
          moConfig.includeList,
          moConfig.ignoreList
        );

        // 添加到待处理的更改列表
        pendingChanges.push({ filePath, content: fileContent });

        console.log(
          chalk.green(
            logSymbols.success,
            `File modified successfully: ${filePath}`
          )
        );
        ws.send(
          JSON.stringify({
            success: true,
            message: '文件修改成功',
            content: fileContent,
            filePath: filePath,
            directoryStructure: directoryStructure
          })
        );
      } catch (err) {
        console.error(
          chalk.red(logSymbols.error, `File operation failed: ${filePath}`),
          err
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: '文件操作失败',
            error: err.message,
            filePath
          })
        );
      }
    } else if (action === 'commitChanges') {
      // 检查是否允许 git 操作
      if (moConfig.git !== true) {
        console.warn(
          chalk.yellow(
            logSymbols.warning,
            'Git operations are disabled in mo.config.json'
          )
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: 'Git操作在配置中被禁用'
          })
        );
        return;
      }

      if (pendingChanges.length > 0 && summary) {
        const commitSuccess = gitCommit(summary);
        if (commitSuccess) {
          console.log(
            chalk.green(logSymbols.success, 'All changes committed to Git')
          );
          ws.send(
            JSON.stringify({
              success: true,
              message: '所有更改已成功提交到Git',
              summary: summary
            })
          );
          pendingChanges = []; // 清空待处理的更改列表
        } else {
          console.error(chalk.red(logSymbols.error, 'Git commit failed'));
          ws.send(
            JSON.stringify({
              success: false,
              message: 'Git提交失败'
            })
          );
        }
      } else if (pendingChanges.length === 0) {
        console.warn(
          chalk.yellow(logSymbols.warning, 'No pending changes to commit')
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: '没有待处理的更改'
          })
        );
      } else {
        console.warn(
          chalk.yellow(logSymbols.warning, 'Missing commit summary')
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: '缺少提交摘要'
          })
        );
      }
    } else if (action === 'initializationComplete') {
      try {
        moConfig.isInitialized = true;
        fs.writeFileSync(moConfigPath, JSON.stringify(moConfig, null, 2));
        console.log(
          chalk.green(
            logSymbols.success,
            'Project initialization status updated'
          )
        );
      } catch (err) {
        console.error(
          chalk.red(
            logSymbols.error,
            'Failed to update project initialization status or appId'
          ),
          err
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: '更新项目初始化状态或appId失败',
            error: err.message
          })
        );
      }
    } else if (action === 'sendAppId') {
      moConfig.appId = appId;
      moConfig.isInitialized = true;
      fs.writeFileSync(moConfigPath, JSON.stringify(moConfig, null, 2));
      console.log(
        chalk.green(
          logSymbols.success,
          'Project initialization marked as complete, appId written to config'
        )
      );
      ws.send(
        JSON.stringify({
          success: true,
          message: '项目初始化成功标记已更新，appId已写入配置'
        })
      );
    } else if (action === 'rollback') {
      // 检查是否允许 git 操作
      if (moConfig.git !== true) {
        console.warn(
          chalk.yellow(
            logSymbols.warning,
            'Git operations are disabled in mo.config.json'
          )
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: 'Git操作在配置中被禁用'
          })
        );
        return;
      }

      const rollbackSuccess = gitRollback();
      if (rollbackSuccess) {
        console.log(
          chalk.green(
            logSymbols.success,
            'Successfully rolled back to the previous commit'
          )
        );
      } else {
        console.error(chalk.red(logSymbols.error, 'Rollback failed'));
      }
      ws.send(
        JSON.stringify({
          success: rollbackSuccess,
          message: rollbackSuccess ? '成功回滚到上一个提交' : '回滚失败'
        })
      );
    } else if (action === 'executeCommand') {
      // 检查是否允许执行命令
      if (moConfig.cmd !== true) {
        console.warn(
          chalk.yellow(
            logSymbols.warning,
            'Command execution is disabled in mo.config.json'
          )
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: '命令执行在配置中被禁用'
          })
        );
        return;
      }

      if (!command) {
        console.warn(
          chalk.yellow(logSymbols.warning, 'Missing command parameter')
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: '缺少命令参数'
          })
        );
        return;
      }

      try {
        const output = await executeCommand(command);
        console.log(
          chalk.green(
            logSymbols.success,
            `Command executed successfully: ${command}`
          )
        );
        ws.send(
          JSON.stringify({
            success: true,
            message: '命令执行成功',
            output: output
          })
        );
      } catch (error) {
        console.error(
          chalk.red(logSymbols.error, `Command execution failed: ${command}`),
          error
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: '命令执行失败',
            error: error
          })
        );
      }
    } else if (action === 'refreshFileTree') {
      try {
        directoryStructure = getDirectoryStructure(
          rootDir,
          moConfig.includeList,
          moConfig.ignoreList
        );
        if (directoryStructure.length === 0) {
          console.warn(
            chalk.yellow(
              logSymbols.warning,
              'No files or directories found matching the include patterns'
            )
          );
          ws.send(
            JSON.stringify({
              success: false,
              message: '没有找到匹配的文件或目录',
              directoryStructure: []
            })
          );
        } else {
          console.log(
            chalk.green(logSymbols.success, 'File tree refreshed successfully')
          );
          ws.send(
            JSON.stringify({
              success: true,
              message: '文件目录刷新成功',
              directoryStructure: directoryStructure
            })
          );
        }
      } catch (error) {
        console.error(
          chalk.red(logSymbols.error, 'Failed to refresh file tree:'),
          error.message
        );
        ws.send(
          JSON.stringify({
            success: false,
            message: '刷新文件目录失败',
            error: error.message
          })
        );
      }
    }
  });
});

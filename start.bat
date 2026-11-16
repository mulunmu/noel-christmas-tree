@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   NOEL - Particle Christmas Tree
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 未检测到 Node.js，请先安装 Node.js 18+：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo 当前 Node.js 版本：%NODE_VER%
echo.

if not exist "node_modules" (
  echo 首次运行，正在安装依赖（使用国内镜像源，请稍候）...
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo.
    echo [ERROR] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
  echo 依赖安装完成。
  echo.
)

echo 正在启动开发服务器，启动后请在浏览器打开终端中显示的地址
echo 默认地址：http://localhost:5173/
echo 关闭本窗口即可停止服务器。
echo.

call npm run dev
pause

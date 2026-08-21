import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, nativeTheme } from 'electron'
import { AppDatabase } from './database'
import { CredentialStore } from './credentials'
import { SnapshotService } from './snapshot'
import { ReceiptService } from './receipt'
import { AgentService } from './agent'
import { ParrotOptimizeService } from './parrot-ai'
import { AppearanceService } from './appearance'
import { AppSettingsService } from './appSettings'
import { registerIpc } from './ipc'

let mainWindow:BrowserWindow|null=null

if(process.env.CRAZY_PARROT_USER_DATA) app.setPath('userData',process.env.CRAZY_PARROT_USER_DATA)

function isAllowedRendererUrl(url:string):boolean {
  try {
    const configured=process.env.ELECTRON_RENDERER_URL
    if(configured)return new URL(url).origin===new URL(configured).origin
    return new URL(url).pathname===pathToFileURL(join(__dirname,'../renderer/index.html')).pathname
  } catch { return false }
}

function createWindow():void {
  mainWindow=new BrowserWindow({
    width:1480,height:940,minWidth:1100,minHeight:720,titleBarStyle:'hiddenInset',backgroundColor:'#0b0e14',
    webPreferences:{preload:join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}
  })
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(!isAllowedRendererUrl(url))event.preventDefault()})
  mainWindow.webContents.on('will-redirect',(event,url)=>{if(!isAllowedRendererUrl(url))event.preventDefault()})
  if(process.env.ELECTRON_RENDERER_URL)void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname,'../renderer/index.html'))
  mainWindow.on('closed',()=>{mainWindow=null})
}

app.whenReady().then(async()=>{
  const userData=app.getPath('userData')
  const db=new AppDatabase(join(userData,'crazy-parrot.sqlite'))
  const credentials=new CredentialStore(join(userData,'secure','credentials.json'))
  const snapshots=new SnapshotService(join(userData,'snapshots'),db)
  const receipts=new ReceiptService(db,snapshots)
  const settings=new AppSettingsService(db)
  const agent=new AgentService(db,credentials,snapshots,receipts,()=>mainWindow,settings)
  const optimizer=new ParrotOptimizeService(db,credentials,()=>mainWindow,settings)
  const appearance=new AppearanceService(db,userData)
  nativeTheme.themeSource=(await appearance.get()).theme
  registerIpc(db,credentials,snapshots,receipts,agent,optimizer,appearance,settings)
  void agent.resume()
  createWindow()
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})
})
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()})

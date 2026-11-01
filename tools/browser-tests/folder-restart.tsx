// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderDirectory } from '../../src/ui/Folders';
import { openFolder, useApp } from '../../src/library/store';
import { lastFolder } from '../../src/library/folders';
const dirs: Record<string, { path: string; name: string }[]> = {
  '/': [...Array.from({ length: 20 }, (_, i) => ({ path: `/before-${i}`, name: `Before ${i}` })), {path:'/archive',name:'Archive'}, {path:'/other',name:'Other'}],
  '/archive': [{path:'/archive/trip',name:'Trip'}], '/archive/trip': [],
  '/home': [], '/other': [{path:'/other/child',name:'Child'}],
};
(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any) => {
  if(cmd==='computer_folders'){ if(sessionStorage.getItem('folder-restart-phase'))await new Promise(r=>setTimeout(r,700)); return [{path:'/home',name:'Home'}, {path:'/',name:'Computer'}]; }
  if(cmd==='browse_directory')return dirs[args.path]??[];
  if(cmd==='scan_folder')return {root:args.path,name:args.path.split('/').pop(),entries:[],folders:dirs[args.path]??[],focus:null,unreadable:0};
  if(cmd==='white_points')return [];
} };
const root=createRoot(document.getElementById('root')!);
root.render(<FolderDirectory/>);
const pause=()=>new Promise(r=>setTimeout(r,200));
const click=(label:string)=>{const b=document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);if(!b)throw Error(`Missing ${label}`);b.click();};
setTimeout(async()=>{try{
  if(!sessionStorage.getItem('folder-restart-phase')){
    click('Expand Computer');await pause();click('Expand Archive');await pause();click('Expand Other');await pause();
    document.querySelector<HTMLButtonElement>('[title="/archive/trip"]')!.click();await pause();
    if(lastFolder()!=='/archive/trip')throw Error('Failed to remember opened folder');
    const sidebar=document.querySelector<HTMLElement>('.folder-directory')!;
    const active=document.querySelector<HTMLElement>('[aria-current="location"]')!;
    sidebar.scrollTop=active.offsetTop-sidebar.clientHeight/2;
    sidebar.dispatchEvent(new Event('scroll'));await pause();
    sessionStorage.setItem('folder-restart-scroll',String(sidebar.scrollTop));
    sessionStorage.setItem('folder-restart-phase','restoring');location.reload();return;
  }
  // A fresh page has a fresh app store, as on restart. Use the real persisted last-folder path.
  await openFolder(lastFolder()!);await pause();await pause();
  if(useApp.getState().folder?.root!=='/archive/trip')throw Error('Photo folder itself did not restore');
  if(!document.querySelector('[aria-current="location"][title="/archive/trip"]'))throw Error('Last folder restored, but tree restarted at Computer with its active folder hidden');
  if(sessionStorage.getItem('folder-restart-phase') === 'restoring') {
    if(!document.querySelector('[title="/other/child"]'))throw Error('Previously expanded branch was lost after restart');
    const restoredScroll=document.querySelector<HTMLElement>('.folder-directory')!.scrollTop;
    const expectedScroll=Number(sessionStorage.getItem('folder-restart-scroll'));
    if(expectedScroll <= 0 || Math.abs(restoredScroll-expectedScroll)>1)throw Error(`Tree scroll not restored: expected ${expectedScroll}, got ${restoredScroll}`);
    // Old installations have a remembered photo folder but no saved tree yet.
    localStorage.removeItem('emulsion.folderTree');
    sessionStorage.setItem('folder-restart-phase','without-tree');location.reload();return;
  }
  document.body.dataset.result='PASS: restart restores last folder, expanded branches and scroll; old installations also reveal the remembered folder without saved tree state';
}catch(e){document.body.dataset.result=`FAIL: ${String(e)}`;}},500);

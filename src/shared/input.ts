export function shouldSubmitPrompt(key:string,shiftKey:boolean,isComposing:boolean):boolean {
  return key==='Enter'&&!shiftKey&&!isComposing
}

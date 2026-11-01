const fs=require('node:fs');
const acorn=require('acorn');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/config.js'),'utf8');
const functions=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='FunctionDeclaration');
const functionSource=name=>{const n=functions.find(e=>e.declaration.id.name===name).declaration;return source.slice(n.start,n.end);};
test('Gemini key fallback only reads the current account cache',async()=>{
    const values=new Map([['user_gemini_key','private-key-for-a'],['user_gemini_key_uid','teacher-a']]);
    const window={profileUserApiKeys:['runtime-key-for-a'],profileUserApiKeysOwner:'teacher-a'};
    const auth={currentUser:{uid:'teacher-b'}};
    const get=new Function('auth','db','window','localStorage',functionSource('getUserGeminiApiKeysAsync')+';return getUserGeminiApiKeysAsync;')(auth,null,window,{getItem:key=>values.get(key)});
    expect(await get()).toEqual([]);auth.currentUser.uid='teacher-a';expect(await get()).toEqual(['runtime-key-for-a']);
    window.profileUserApiKeys=[];expect(await get()).toEqual(['private-key-for-a']);
});
test('an aborted Gemini request does not rotate to another key',async()=>{
    const fetchWithFallback=new Function('getUserGeminiApiKeysAsync','AI_CONFIG',functionSource('fetchGeminiWithFallback')+';return fetchGeminiWithFallback;')(async()=>['a','b'],{});
    const request=jest.fn().mockRejectedValue(Object.assign(new Error('Stopped'),{name:'AbortError'}));
    await expect(fetchWithFallback(request)).rejects.toMatchObject({name:'AbortError'});expect(request).toHaveBeenCalledTimes(1);
});

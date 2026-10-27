import{t as e}from"./shaderStore-DIVYgOBs.js";import{n as t,t as n}from"./clipPlaneFragment-CbmeO_iX.js";import{t as r}from"./logDepthDeclaration-B9VzRHv9.js";import{t as i}from"./logDepthFragment-BetZcPYt.js";var a=`linePixelShader`,o=`#include<clipPlaneFragmentDeclaration>
uniform vec4 color;
#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<logDepthFragment>
#include<clipPlaneFragment>
gl_FragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[a]||(e.ShadersStore[a]=o);var s=[t,r,i,n];for(let t of s)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var c={name:a,shader:o};export{c as linePixelShader};
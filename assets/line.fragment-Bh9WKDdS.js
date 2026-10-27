import{t as e}from"./shaderStore-DIVYgOBs.js";import{n as t,t as n}from"./clipPlaneFragment-GgYGCegB.js";import{t as r}from"./logDepthDeclaration-BCFySzeY.js";import{t as i}from"./logDepthFragment-DIbV8e0m.js";var a=`linePixelShader`,o=`#include<clipPlaneFragmentDeclaration>
uniform color: vec4f;
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<logDepthFragment>
#include<clipPlaneFragment>
fragmentOutputs.color=uniforms.color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStoreWGSL[a]||(e.ShadersStoreWGSL[a]=o);var s=[t,r,i,n];for(let t of s)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var c={name:a,shader:o};export{c as linePixelShaderWGSL};
export function createTaskState(){
 let version=0,model=null;
 return {begin(){model=null;return ++version;},isCurrent(id){return id===version;},finish(id,value){if(id!==version)return false;model=value;return true;},get model(){return model;}};
}

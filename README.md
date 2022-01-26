# Exobase Build Stacks

> These are the packages that Exobase uses to deploy stacks.

## What's in here?
Each builder package expects to have a `context.json` that contains a `DeploymentContext` and a `./source` directory that contains the source. The `context.service.config` is used to configure the resources. The build stacks are all built on top of [exobase-inc/exobase-pulumi](https://github.com/exobase-inc/exobase-pulumi) packages. Some build stacks might reference many of the the pulumi component resources in that repo. 

### Packages
The packages in this repo are not actually deployed. We use Lerna and a monorepo structure to reduce node_modules size. There are (and will be) many many stack builders in this repo, do not want to install deps for each one. Especially because this repo is cloned and setup on our builder server (which runs via the `task-runner-aws-code-build` stack).

### Naming convention: 
Pattern: `{exobase-service-type}-{cloud-provider}-{provider-service}-{language?}`  
Exmaple: `{api}-{aws}-{lambda}-{typescript}`  
Reads: Exobase api on aws lambda in typescript
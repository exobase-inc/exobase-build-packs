import _ from 'radash'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import fs from 'fs-extra'
import cmd from 'cmdish'
import { AWSCodeBuildProject } from '@exobase/pulumi-aws-code-build'
import { AWSLambdaAPI } from '@exobase/pulumi-aws-lambda-api'
import { DeploymentContext } from '@exobase/client-js'
import octo from 'octokit-downloader'


type Config = {
  buildTimeoutSeconds: number
  useBridgeApi: boolean
  buildCommand: string
  bridgeApiKey?: string
  dockerImage: string
}

type Outputs = {
  url?: pulumi.Output<string> | string
}

const main = async (): Promise<Outputs> => {

  //
  //  READ PROJECT CONFIG
  //
  const context = await fs.readJSON('./context.json') as DeploymentContext
  const {
    platform,
    service,
    deployment
  } = context
  const config = deployment.config.stack as Config


  //
  //  SETUP PROVIDER
  //
  const provider = new aws.Provider('aws', {
    secretKey: platform.providers.aws.accessKeySecret,
    accessKey: platform.providers.aws.accessKeyId,
    region: platform.providers.aws.region as aws.Region
  })


  //
  //  CREATE SOURCE ZIP
  //
  await installSourceDependencies()


  //
  //  CREATE CODE BUILD PROJECT
  //
  const project = new AWSCodeBuildProject(_.dashCase(service.name), {
    sourceDir: `${__dirname}/source`,
    buildTimeoutSeconds: toNumber(config.buildTimeoutSeconds),
    buildCommand: config.buildCommand,
    image: config.dockerImage, // 'node:16',
    environmentVariables: deployment.config.environmentVariables.map(ev => ({
      name: ev.name,
      value: ev.value
    }))
  }, { provider })

  if (!config.useBridgeApi) {
    return {
      url: null
    }
  }


  //
  //  CREATE BRIDGE API
  //
  //  A todo here is to version the bridge. Pull from specific
  //  release version branch.
  //
  await octo.download({
    from: 'https://github.com/exobase-inc/aws-cloud-build-trigger-bridge',
    to: `${__dirname}/bridge.zip`,
    unzip: true
  })
  const api = new AWSLambdaAPI(_.dashCase(`${service.name}-bridge`), {
    sourceDir: `${__dirname}/bridge`,
    sourceExt: 'ts',
    timeout: 1,
    memory: 128,
    runtime: 'nodejs14.x',
    distDirName: 'build',
    buildCommand: (() => {
      const useNvm = !!process.env.USE_NVM
      const nvmPrefix = 'source ~/.nvm/nvm.sh && nvm use && '
      const cmd = 'yarn && yarn build && cp package.json ./build/package.json && cd build && yarn'
      return `${useNvm ? nvmPrefix : ''}${cmd}`
    })(),
    environmentVariables: {
      AWS_CODE_BUILD_PROJECT_NAME: project.project.name,
      BRIDGE_API_KEY: config.bridgeApiKey
    },
    domain: service.domain
  }, { provider })

  const lambdaStartBuildPolicy = new aws.iam.Policy("lambdaStartBuild", {
    path: "/",
    description: "IAM policy for logging from a lambda",
    policy: pulumi.interpolate`{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Action": [
          "codebuild:StartBuild"
        ],
        "Effect": "Allow",
        "Resource": "${project.project.arn}"
      }
    ]
  }
  `
  }, { provider })

  new aws.iam.RolePolicyAttachment("lambdaStartBuilds", {
    role: api.role.name,
    policyArn: lambdaStartBuildPolicy.arn,
  }, { provider })

  return {
    url: service.domain ? service.domain.fqd : api.api.url
  }
}

const installSourceDependencies = async () => {

  const USE_NVM = !!process.env.USE_NVM

  //
  // Install dependencies
  //
  if (USE_NVM) {
    const [err] = await cmd('source ~/.nvm/nvm.sh && nvm use && yarn', {
      cwd: `${__dirname}/source`
    })
    if (err) throw err
  } else {
    const [err] = await cmd('yarn', {
      cwd: `${__dirname}/source`
    })
    if (err) throw err
  }

}

const toNumber = (value: string | number): number => {
  if (_.isString) return parseInt(value as string)
  return value as number
}

export default main()
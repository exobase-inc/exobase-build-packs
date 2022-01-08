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
  new AWSCodeBuildProject(service.name, {
    sourceDir: `${__dirname}/source`,
    buildTimeoutSeconds: config.buildTimeoutSeconds,
    buildCommand: config.buildCommand,
    image: 'node:16',
    environmentVariables: deployment.config.environmentVariables
  }, { provider })

  if (!config.useBridgeApi) {
    return {
      url: null
    }
  }


  //
  //  CREATE BRIDGE API
  //
  await octo.download({
    from: 'https://github.com/exobase-inc/aws-cloud-build-trigger-bridge',
    to: `${__dirname}/bridge`
  })
  const api = new AWSLambdaAPI('bridge', {
    sourceDir: `${__dirname}/bridge`,
    sourceExt: 'ts',
    environmentVariables: [{
      name: 'AWS_CODE_BUILD_PROJECT_NAME',
      value: service.name
    }, {
      name: 'BRIDGE_API_KEY',
      value: config.bridgeApiKey
    }],
    domain: service.domain
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

export default main()
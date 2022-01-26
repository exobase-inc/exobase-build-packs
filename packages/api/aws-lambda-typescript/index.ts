import _ from 'radash'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import fs from 'fs-extra'
import type { DeploymentContext } from '@exobase/client-js'
import { AWSLambdaAPI } from '@exobase/pulumi-aws-lambda-api'
import path from 'path'


type Config = {
  timeout: number
  memory: number
}

type Outputs = {
  url: pulumi.Output<string> | string
}

const main = async ({
  workingDir
}: {
  workingDir: string
}): Promise<Outputs> => {

  //
  //  READ PROJECT CONFIG
  //
  const context = await fs.readJSON(path.join(workingDir, 'context.json')) as DeploymentContext
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
  //  CREATE API/LAMBDA RESOURCES
  //
  const envVarDict = deployment.config.environmentVariables.reduce((acc, ev) => ({ 
    ...acc, 
    [ev.name]: ev.value 
  }), {})
  const api = new AWSLambdaAPI('api', {
    sourceDir: path.join(workingDir, 'source'),
    sourceExt: 'ts',
    distDirName: 'build',
    buildCommand: (() => {
      const useNvm = !!process.env.USE_NVM
      const nvmPrefix = 'source ~/.nvm/nvm.sh && nvm use && '
      const cmd = 'yarn && yarn build && cp package.json ./build/package.json && cd build && yarn'
      return `${useNvm ? nvmPrefix : ''}${cmd}`
    })(),
    runtime: 'nodejs14.x',
    timeout: toNumber(config.timeout),
    memory: toNumber(config.memory),
    environmentVariables: {
      ...envVarDict,
      EXOBASE_PLATFORM: platform.name,
      EXOBASE_SERVICE: service.name
    },
    domain: service.domain
  }, { provider })

  return {
    url: service.domain ? service.domain.fqd : api.api.url
  }
}

const toNumber = (value: string | number): number => {
  if (_.isString) return parseInt(value as string)
  return value as number
}

export default main
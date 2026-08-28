#!/usr/bin/env ruby
# frozen_string_literal: true

require "open3"
require "yaml"

abort "Usage: #{File.basename($PROGRAM_NAME)} CLOUD_BUILD_CONFIG..." if ARGV.empty?

ARGV.each do |path|
  config = YAML.safe_load_file(path, aliases: true)
  steps = config.fetch("steps")

  steps.each do |step|
    next unless step["entrypoint"] == "bash"

    args = Array(step["args"])
    next unless args.first == "-c"

    script = args[1]
    abort "#{path}: #{step["id"] || step["name"]}: missing bash -c script" unless script.is_a?(String)

    _stdout, stderr, status = Open3.capture3("bash", "-n", stdin_data: script)
    next if status.success?

    warn "#{path}: #{step["id"] || step["name"]}: invalid embedded shell"
    warn stderr
    exit 1
  end

  puts "#{path}: YAML and embedded bash syntax OK"
end

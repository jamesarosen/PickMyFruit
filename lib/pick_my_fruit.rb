require 'sinatra'

class PickMyFruit < Sinatra::Base
  project_root = File.expand_path('..', File.dirname(__FILE__))
  index_html = File.read(project_root + '/public/index.html')

  set :root, project_root

  get '/' do
    index_html
  end
end
